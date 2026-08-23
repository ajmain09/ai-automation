import { IssueStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPreviewIssues, resolvePreviewIssue } from "@/services/preview/store";

export async function upsertActionableIssue(input: { pageId?: string; type: string; title: string; description: string; severity?: string; resolutionAction?: string }) {
  const existing = await prisma.issue.findFirst({ where: { pageId: input.pageId, type: input.type, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
  if (existing) return existing;
  return prisma.issue.create({ data: { pageId: input.pageId, type: input.type, title: input.title, description: input.description, severity: input.severity ?? "medium", resolutionAction: input.resolutionAction } });
}

export async function resolveIssue(issueId: string) {
  if (isDevPreview()) { resolvePreviewIssue(issueId); return; }
  return prisma.issue.update({ where: { id: issueId }, data: { status: IssueStatus.RESOLVED } });
}

export async function getOpenIssues() {
  if (isDevPreview()) return getPreviewIssues();
  return prisma.issue.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { createdAt: "desc" }, include: { page: { select: { id: true, name: true, metaPageId: true } } } });
}
