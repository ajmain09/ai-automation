import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTabs } from "@/components/pages/page-tabs";
import { getPageById } from "@/services/pages/queries";
import { getPageOrders } from "@/services/orders/service";

export const dynamic = "force-dynamic";

export default async function PageOrdersPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const page = await getPageById(pageId);
  if (!page) notFound();
  const orders = await getPageOrders(page.id);
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.id}`}>Pages</Link> / Orders</div><h1>Orders</h1><p className="subtitle">Confirmed orders for {page.name}, isolated to this Page workspace.</p></div></div><PageTabs pageId={page.id} active="Orders" /><section className="card">{orders.length === 0 ? <div className="empty-state"><h3>No orders yet</h3><p>Confirmed orders for this Page will appear here.</p></div> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Product</th><th>Status</th><th>Created</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><div className="product-name">{order.customerName ?? "Unknown"}</div><div className="field-hint">{order.normalizedPhone ?? "No phone"}</div></td><td>{order.productName ?? "—"} {order.quantity ? `× ${order.quantity}` : ""}</td><td><span className={`status-chip ${order.status === "CONFIRMED" ? "green" : order.status === "CANCELLED" ? "red" : "amber"}`}><span className="dot" />{order.status}</span></td><td>{order.createdAt.toLocaleString()}</td></tr>)}</tbody></table></div>}</section></main>;
}
