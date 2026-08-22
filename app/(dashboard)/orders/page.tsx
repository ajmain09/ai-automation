import { getPages } from "@/services/pages/queries";
import { getPageOrders } from "@/services/orders/service";

export default async function OrdersPage() {
  const pages = await getPages();
  const orders = (await Promise.all(pages.map((page) => getPageOrders(page.id).then((items) => items.map((order) => ({ ...order, pageName: page.name })))))).flat();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">Operations</div><h1>Orders</h1><p className="subtitle">Confirmed orders, revisions, and cancellation history across isolated Pages.</p></div></div><section className="card">{orders.length === 0 ? <div className="empty-state"><div className="empty-icon">□</div><h3>No orders yet</h3><p>Orders appear here after backend validation and explicit customer confirmation.</p></div> : <div className="table-wrap"><table><thead><tr><th>Page</th><th>Customer</th><th>Product</th><th>Status</th><th>Created</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td>{order.pageName}</td><td><div className="product-name">{order.customerName ?? "Unknown"}</div><div className="field-hint">{order.normalizedPhone ?? "No phone"}</div></td><td>{order.productName ?? "—"} {order.quantity ? `× ${order.quantity}` : ""}</td><td><span className={`status-chip ${order.status === "CONFIRMED" ? "green" : order.status === "CANCELLED" ? "red" : "amber"}`}><span className="dot" />{order.status}</span></td><td>{order.createdAt.toLocaleString()}</td></tr>)}</tbody></table></div>}</section></main>;
}
