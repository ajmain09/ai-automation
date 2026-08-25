import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { isDevPreview } from "@/lib/env";
import { getPageCustomerMemory } from "@/services/memory/service";
import { getPageById } from "@/services/pages/queries";
import { getPreviewCustomerMemory, getPreviewOrders } from "@/services/preview/store";
import { MemoryInspector } from "@/components/pages/memory-inspector";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ pageId: string; customerId: string }> }) {
  const { pageId: pageRef, customerId } = await params;
  const page = await getPageById(pageRef);
  if (!page) notFound();
  if (pageRef !== page.slug) redirect(`/pages/${page.slug}/customers/${customerId}`);
  const data = isDevPreview() ? { ...getPreviewCustomerMemory(page.id, customerId), orders: getPreviewOrders(page.id).filter((order) => order.customerId === customerId).map((order) => ({ ...order, total: order.total })) } : await loadProductionMemory(page.id, customerId);
  if (!data) notFound();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.slug}/customers`}>Customers</Link> / Customer detail</div><h1>Customer memory</h1><p className="subtitle">Page-scoped memory and order history for {customerId.slice(0, 8)}.</p></div></div><MemoryInspector pageId={page.slug} customerId={customerId} initial={data} /></main>;
}

async function loadProductionMemory(pageId: string, customerId: string) {
  const memory = await getPageCustomerMemory(pageId, customerId);
  if (!memory) return null;
  const orders = await prisma.order.findMany({ where: { pageId, customerId }, orderBy: { createdAt: "desc" }, select: { id: true, orderSessionId: true, status: true, total: true, currency: true, productName: true, quantity: true, createdAt: true, confirmedAt: true } });
  return { ...memory, facts: memory.facts.map((fact) => ({ ...fact, confidence: fact.confidence === null ? null : Number(fact.confidence) })), orders: orders.map((order) => ({ ...order, total: order.total === null ? null : Number(order.total) })) };
}
