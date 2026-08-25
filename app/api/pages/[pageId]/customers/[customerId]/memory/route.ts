import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";
import { getPageById } from "@/services/pages/queries";
import { canonicalFactKey, clearNonOrderMemory, editCustomerFact, getPageCustomerMemory, markCustomerFactUnknown, rebuildCustomerSummary, removeCustomerFact } from "@/services/memory/service";
import { clearPreviewNonOrderMemory, editPreviewCustomerFact, getPreviewCustomerMemory, getPreviewOrders, markPreviewCustomerFactUnknown, rebuildPreviewCustomerSummary, removePreviewCustomerFact } from "@/services/preview/store";

const actionSchema = z.object({ action: z.enum(["edit", "markUnknown", "remove", "rebuildSummary", "clearNonOrderMemory"]), factKey: z.string().trim().min(1).max(80).optional(), value: z.string().trim().max(500).optional() });

async function view(pageId: string, customerId: string) {
  if (isDevPreview()) {
    const memory = getPreviewCustomerMemory(pageId, customerId);
    return { ...memory, orders: getPreviewOrders(pageId).filter((order) => order.customerId === customerId || order.customerId === `deleted:${pageId}`) };
  }
  const memory = await getPageCustomerMemory(pageId, customerId);
  if (!memory) return null;
  const orders = await prisma.order.findMany({ where: { pageId, customerId }, orderBy: { createdAt: "desc" }, select: { id: true, orderSessionId: true, status: true, total: true, currency: true, productName: true, quantity: true, createdAt: true, confirmedAt: true } });
  return { ...memory, facts: memory.facts.map((fact) => ({ ...fact, confidence: fact.confidence === null ? null : Number(fact.confidence) })), orders };
}

export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string; customerId: string }> }) {
  await requireAdmin();
  const { pageId: pageRef, customerId } = await params;
  const page = await getPageById(pageRef);
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  const data = await view(page.id, customerId).catch(() => null);
  if (!data) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  return NextResponse.json({ data });
}

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string; customerId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const admin = await requireAdmin();
  const { pageId: pageRef, customerId } = await params;
  const page = await getPageById(pageRef);
  if (!page) return NextResponse.json({ error: "Page not found." }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the requested memory action." }, { status: 400 });
  if (["edit", "markUnknown", "remove"].includes(parsed.data.action) && !canonicalFactKey(parsed.data.factKey ?? "")) return NextResponse.json({ error: "Unsupported memory fact key." }, { status: 400 });
  const input = { pageId: page.id, customerId, factKey: parsed.data.factKey ?? "", value: parsed.data.value ?? "", adminId: admin.id };
  try {
    if (isDevPreview()) {
      if (parsed.data.action === "edit") editPreviewCustomerFact(input);
      else if (parsed.data.action === "markUnknown") markPreviewCustomerFactUnknown(input);
      else if (parsed.data.action === "remove") removePreviewCustomerFact(input);
      else if (parsed.data.action === "rebuildSummary") rebuildPreviewCustomerSummary(input);
      else clearPreviewNonOrderMemory(input);
    } else if (parsed.data.action === "edit") await editCustomerFact(input);
    else if (parsed.data.action === "markUnknown") await markCustomerFactUnknown(input);
    else if (parsed.data.action === "remove") await removeCustomerFact(input);
    else if (parsed.data.action === "rebuildSummary") await rebuildCustomerSummary(input);
    else await clearNonOrderMemory(input);
    const data = await view(page.id, customerId);
    if (!data) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Memory action failed." }, { status: 400 });
  }
}
