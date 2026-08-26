import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { JobStatus, Prisma } from "@prisma/client";
import { reconcileExpiredBudgetReservations } from "@/services/usage/budget";

export type QueueJob<T = unknown> = {
  id: string; pageId?: string; conversationId?: string; type: string; payload: T;
  attempts: number; maxAttempts: number; runAt: Date; expiresAt?: Date | null;
  idempotencyKey?: string;
};
export type EnqueueInput<T = unknown> = { pageId?: string; conversationId?: string; type: string; payload: T; delayMs?: number; ttlMs?: number; idempotencyKey?: string; maxAttempts?: number };

export interface JobQueue {
  enqueue<T>(input: EnqueueInput<T>): Promise<QueueJob<T>>;
  claim(workerId: string): Promise<QueueJob | null>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, now?: Date): Promise<void>;
  release(id: string): Promise<void>;
  expire(now?: Date): Promise<number>;
}

export function retryDelayMs(attempt: number, random = Math.random) {
  const base = Math.min(60_000, 1_000 * (2 ** Math.max(0, attempt - 1)));
  return Math.round(base * (0.75 + random() * 0.5));
}

export class InMemoryJobQueue implements JobQueue {
  private jobs: Array<QueueJob & { status: JobStatus; leaseUntil?: Date; lastError?: string }> = [];
  private sequence = 0;
  async enqueue<T>(input: EnqueueInput<T>) {
    const existing = input.idempotencyKey && this.jobs.find((job) => job.idempotencyKey === input.idempotencyKey);
    if (existing) return existing as QueueJob<T>;
    const job: QueueJob<T> & { status: JobStatus; leaseUntil?: Date } = { id: `job-${++this.sequence}`, pageId: input.pageId, conversationId: input.conversationId, type: input.type, payload: input.payload as T, attempts: 0, maxAttempts: input.maxAttempts ?? 5, runAt: new Date(Date.now() + (input.delayMs ?? 0)), expiresAt: input.ttlMs ? new Date(Date.now() + input.ttlMs) : null, status: "PENDING", idempotencyKey: input.idempotencyKey };
    this.jobs.push(job);
    return job;
  }
  async claim(workerId: string) {
    void workerId;
    const now = new Date();
    for (const job of this.jobs) if (job.status === "RUNNING" && job.leaseUntil && job.leaseUntil <= now) { job.status = "PENDING"; job.leaseUntil = undefined; }
    const activeConversations = new Set(this.jobs.filter((job) => job.status === "RUNNING" && job.conversationId).map((job) => job.conversationId));
    const candidate = this.jobs.find((job) => job.status === "PENDING" && job.runAt <= now && (!job.expiresAt || job.expiresAt > now) && (!job.conversationId || !activeConversations.has(job.conversationId)));
    if (!candidate) return null;
    if (candidate.conversationId && this.jobs.some((job) => job.conversationId === candidate.conversationId && job.status === "RUNNING")) return null;
    candidate.status = "RUNNING"; candidate.attempts += 1; candidate.leaseUntil = new Date(now.getTime() + 60_000);
    return candidate;
  }
  async complete(id: string) { const job = this.jobs.find((item) => item.id === id); if (job) job.status = "SUCCEEDED"; }
  async fail(id: string, error: string, now = new Date()) { const job = this.jobs.find((item) => item.id === id); if (!job) return; job.lastError = error; job.leaseUntil = undefined; if (job.attempts >= job.maxAttempts) job.status = "DEAD_LETTER"; else { job.status = "PENDING"; job.runAt = new Date(now.getTime() + retryDelayMs(job.attempts)); } }
  async release(id: string) { const job = this.jobs.find((item) => item.id === id); if (job && job.status === "RUNNING") { job.status = "PENDING"; job.leaseUntil = undefined; } }
  async expire(now = new Date()) { let count = 0; for (const job of this.jobs) if (job.status === "PENDING" && job.expiresAt && job.expiresAt <= now) { job.status = "EXPIRED"; count++; } return count; }
  snapshot() { return this.jobs.map((job) => ({ ...job })); }
}

export class PostgresJobQueue implements JobQueue {
  async enqueue<T>(input: EnqueueInput<T>) {
    const runAt = new Date(Date.now() + (input.delayMs ?? 0));
    const expiresAt = input.ttlMs ? new Date(Date.now() + input.ttlMs) : undefined;
    try {
      return await prisma.job.create({ data: { pageId: input.pageId, conversationId: input.conversationId, type: input.type, payload: input.payload as Prisma.InputJsonValue, runAt, expiresAt, idempotencyKey: input.idempotencyKey, maxAttempts: input.maxAttempts ?? 5 } }) as unknown as QueueJob<T>;
    } catch (error) {
      if (input.idempotencyKey) {
        const existing = await prisma.job.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return existing as unknown as QueueJob<T>;
      }
      throw error;
    }
  }
  async claim(workerId: string) {
    return prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.job.updateMany({ where: { status: "RUNNING", leaseUntil: { lt: now } }, data: { status: "PENDING", leaseUntil: null } });
      const active = await tx.job.findMany({ where: { status: "RUNNING", conversationId: { not: null } }, select: { conversationId: true } });
      const activeConversationIds = active.flatMap((item) => item.conversationId ? [item.conversationId] : []);
      const candidate = await tx.job.findFirst({ where: { status: "PENDING", runAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], AND: [{ OR: [{ conversationId: null }, { conversationId: { notIn: activeConversationIds } }] }] }, orderBy: { runAt: "asc" } });
      if (!candidate) return null;
      if (candidate.conversationId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.conversationId}, 0))`;
        const active = await tx.job.count({ where: { conversationId: candidate.conversationId, status: "RUNNING" } });
        if (active > 0) return null;
      }
      const claimed = await tx.job.update({ where: { id: candidate.id }, data: { status: "RUNNING", attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + 60_000), lockedAt: now, lastError: null } });
      return { ...claimed, payload: claimed.payload ?? {}, workerId } as unknown as QueueJob;
    });
  }
  async complete(id: string) { await prisma.job.update({ where: { id }, data: { status: "SUCCEEDED", leaseUntil: null } }); }
  async fail(id: string, error: string, now = new Date()) { const job = await prisma.job.findUnique({ where: { id } }); if (!job) return; const terminal = job.attempts >= job.maxAttempts; await prisma.$transaction(async (tx) => { await tx.job.update({ where: { id }, data: { status: terminal ? "DEAD_LETTER" : "PENDING", runAt: new Date(now.getTime() + (terminal ? 0 : retryDelayMs(job.attempts))), leaseUntil: null, lastError: error.slice(0, 1000) } }); if (terminal) await tx.issue.create({ data: { pageId: job.pageId, type: "FAILED_JOB", severity: "high", title: "Job moved to dead letter", description: error.slice(0, 500), resolutionAction: "Review the failed job and retry after correcting the underlying issue." } }); }); }
  async release(id: string) { await prisma.job.updateMany({ where: { id, status: "RUNNING" }, data: { status: "PENDING", leaseUntil: null } }); }
  async expire(now = new Date()) { const result = await prisma.job.updateMany({ where: { status: { in: ["PENDING", "RUNNING"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED", leaseUntil: null } }); return result.count; }
}

export async function enqueuePostgresJobTx<T>(tx: Prisma.TransactionClient, input: EnqueueInput<T>) {
  const runAt = new Date(Date.now() + (input.delayMs ?? 0));
  const expiresAt = input.ttlMs ? new Date(Date.now() + input.ttlMs) : undefined;
  try { return await tx.job.create({ data: { pageId: input.pageId, conversationId: input.conversationId, type: input.type, payload: input.payload as Prisma.InputJsonValue, runAt, expiresAt, idempotencyKey: input.idempotencyKey, maxAttempts: input.maxAttempts ?? 5 } }); }
  catch (error) { if (input.idempotencyKey) { const existing = await tx.job.findUnique({ where: { idempotencyKey: input.idempotencyKey } }); if (existing) return existing; } throw error; }
}

export async function runWorker(queue: JobQueue, handler: (job: QueueJob) => Promise<void>, options: { signal?: AbortSignal; pollMs?: number; workerId?: string } = {}) {
  const workerId = options.workerId ?? `worker-${crypto.randomUUID()}`;
  let lastMaintenance = 0;
  while (!options.signal?.aborted) {
    await queue.expire();
    if (Date.now() - lastMaintenance >= 60_000) { await reconcileExpiredBudgetReservations().catch(() => undefined); lastMaintenance = Date.now(); }
    const job = await queue.claim(workerId);
    if (!job) { await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 250)); continue; }
    try { await handler(job); await queue.complete(job.id); } catch (error) { await queue.fail(job.id, error instanceof Error ? error.message : "Unknown job failure"); }
  }
}
