import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type BudgetReservation = { allowed: boolean; reason?: "PAGE_LIMIT"; reservedBdt: number; reservationKey?: string };

/** Pure decision used by preview and unit tests. There is deliberately no global budget input. */
export function reserveBudget(input: { estimatedBdt: number; usedBdt: number; budgetBdt?: number | null; hardLimit: boolean }): BudgetReservation {
  const estimate = Math.max(0, input.estimatedBdt);
  if (input.hardLimit && input.budgetBdt !== null && input.budgetBdt !== undefined && input.usedBdt + estimate > input.budgetBdt) return { allowed: false, reason: "PAGE_LIMIT", reservedBdt: 0 };
  return { allowed: true, reservedBdt: estimate };
}

export class PageBudgetExceededError extends Error {
  readonly code = "PAGE_BUDGET_LIMIT";
  constructor(public readonly pageId: string) { super("This Page has reached its hard AI budget."); }
}

/** The conditional update and reservation row are committed together. */
export async function reservePageBudgetAtomic(pageId: string, estimatedBdt: number, reservationKey?: string, ttlMs = 10 * 60_000): Promise<BudgetReservation> {
  const estimate = Math.max(0, estimatedBdt);
  if (estimate === 0) return { allowed: true, reservedBdt: 0, reservationKey };
  const changed = await prisma.$transaction(async (tx) => {
    const settings = await tx.pageCostSettings.findUnique({ where: { pageId }, select: { pageId: true } });
    if (!settings) return 1;
    const result = await tx.$executeRaw(Prisma.sql`
      UPDATE "PageCostSettings" AS budget
      SET "reservedBdt" = "reservedBdt" + ${estimate}
      WHERE budget."pageId" = ${pageId}::uuid
        AND (budget."hardLimit" = false OR budget."monthlyBudgetBdt" IS NULL OR (COALESCE((SELECT SUM(COALESCE(u."estimatedCostBdt", 0)) FROM "ApiUsage" u WHERE u."pageId" = budget."pageId" AND u."createdAt" >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'), 0) + budget."reservedBdt" + ${estimate} <= budget."monthlyBudgetBdt"))
        AND (budget."hardLimit" = false OR budget."dailyBudgetBdt" IS NULL OR (COALESCE((SELECT SUM(COALESCE(u."estimatedCostBdt", 0)) FROM "ApiUsage" u WHERE u."pageId" = budget."pageId" AND u."createdAt" >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'Asia/Dhaka'), 0) + budget."reservedBdt" + ${estimate} <= budget."dailyBudgetBdt"))
    `);
    if (result !== 1) return 0;
    if (reservationKey) await tx.aiBudgetReservation.create({ data: { pageId, reservationKey, estimatedBdt: estimate, expiresAt: new Date(Date.now() + ttlMs) } });
    return 1;
  });
  if (changed === 1) return { allowed: true, reservedBdt: estimate, reservationKey };
  await prisma.$transaction(async (tx) => {
    await tx.page.update({ where: { id: pageId }, data: { aiEnabled: false, aiStatus: "PAUSED_BY_BUDGET" } });
    await tx.pageCostSettings.update({ where: { pageId }, data: { pausedByBudget: true } });
    const existing = await tx.issue.findFirst({ where: { pageId, type: "PAGE_BUDGET_LIMIT", status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { id: true } });
    if (!existing) await tx.issue.create({ data: { pageId, type: "PAGE_BUDGET_LIMIT", severity: "high", title: "AI paused by Page budget", description: "This Page reached its hard AI budget. Incoming Messenger messages continue to be received and stored.", resolutionAction: "Increase this Page budget or resume AI after reviewing usage." } });
  }).catch(() => undefined);
  throw new PageBudgetExceededError(pageId);
}

export async function releasePageBudgetReservation(pageId: string, reservedBdt: number) {
  if (reservedBdt <= 0) return;
  await prisma.$executeRaw(Prisma.sql`UPDATE "PageCostSettings" SET "reservedBdt" = GREATEST(0, "reservedBdt" - ${reservedBdt}) WHERE "pageId" = ${pageId}::uuid`);
}

export async function settlePageBudgetReservationTx(tx: Prisma.TransactionClient, input: { pageId: string; reservationKey?: string; actualBdt: number; success: boolean }) {
  if (!input.reservationKey) return;
  const reservation = await tx.aiBudgetReservation.findFirst({ where: { pageId: input.pageId, reservationKey: input.reservationKey, status: "RESERVED" }, select: { estimatedBdt: true } });
  if (!reservation) return;
  await tx.aiBudgetReservation.update({ where: { reservationKey: input.reservationKey }, data: { status: input.success ? "SETTLED" : "RELEASED", settledBdt: Math.max(0, input.actualBdt) } });
  await tx.$executeRaw(Prisma.sql`UPDATE "PageCostSettings" SET "reservedBdt" = GREATEST(0, "reservedBdt" - ${Number(reservation.estimatedBdt)}) WHERE "pageId" = ${input.pageId}::uuid`);
}

/** Worker/admin recovery for reservations left behind by a crashed provider call. */
export async function reconcileExpiredBudgetReservations(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const expired = await tx.aiBudgetReservation.findMany({ where: { status: "RESERVED", expiresAt: { lte: now } }, select: { id: true, pageId: true, estimatedBdt: true }, take: 100 });
    for (const reservation of expired) {
      const claimed = await tx.aiBudgetReservation.updateMany({ where: { id: reservation.id, status: "RESERVED" }, data: { status: "EXPIRED" } });
      if (claimed.count === 1) await tx.$executeRaw(Prisma.sql`UPDATE "PageCostSettings" SET "reservedBdt" = GREATEST(0, "reservedBdt" - ${Number(reservation.estimatedBdt)}) WHERE "pageId" = ${reservation.pageId}::uuid`);
    }
    if (expired.length) {
      const existing = await tx.issue.findFirst({ where: { type: "BUDGET_RESERVATION_STUCK", status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { id: true } });
      if (!existing) await tx.issue.create({ data: { type: "BUDGET_RESERVATION_STUCK", severity: "medium", title: "Expired AI budget reservations recovered", description: `${expired.length} abandoned budget reservation(s) were released after their TTL.`, resolutionAction: "Review provider attempts and worker health if this repeats." } });
    }
    return expired.length;
  });
}
