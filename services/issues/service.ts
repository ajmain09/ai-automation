import { IssueStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { createPreviewIssue, getPreviewIssues, resolvePreviewIssue } from "@/services/preview/store";

export async function upsertActionableIssue(input: { pageId?: string; type: string; title: string; description: string; severity?: string; resolutionAction?: string; metadata?: Record<string, unknown> }) {
  if (isDevPreview()) return getPreviewIssues().find((issue) => issue.pageId === (input.pageId ?? null) && issue.type === input.type && issue.status !== "RESOLVED") ?? createPreviewIssue(input);
  const pageId = input.pageId ?? null;
  const existing = await prisma.issue.findFirst({ where: { pageId, type: input.type, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
  const data = { title: input.title, description: input.description, severity: input.severity ?? "medium", resolutionAction: input.resolutionAction, metadata: input.metadata as Prisma.InputJsonValue | undefined };
  if (existing) return prisma.issue.update({ where: { id: existing.id }, data });
  return prisma.issue.create({ data: { pageId, type: input.type, ...data } });
}

export async function resolveIssue(issueId: string) {
  if (isDevPreview()) { resolvePreviewIssue(issueId); return; }
  return prisma.issue.update({ where: { id: issueId }, data: { status: IssueStatus.RESOLVED } });
}

export async function getOpenIssues() {
  if (isDevPreview()) return getPreviewIssues();
  return prisma.issue.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { createdAt: "desc" }, include: { page: { select: { id: true, name: true, metaPageId: true } } } });
}
