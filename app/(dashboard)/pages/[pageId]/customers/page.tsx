import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTabs } from "@/components/pages/page-tabs";
import { getPageById } from "@/services/pages/queries";
import { getPreviewCustomers } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const page = await getPageById(pageId);
  if (!page) notFound();
  const customers = isDevPreview() ? getPreviewCustomers(page.id) : [];
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.slug}`}>Pages</Link> / Customers</div><h1>Customers</h1><p className="subtitle">Page-scoped customer records derived from confirmed sales conversations.</p></div></div><PageTabs pageId={page.slug} active="Customers" /><section className="card">{customers.length === 0 ? <div className="empty-state"><h3>No customers yet</h3><p>Customers for this Page will appear after confirmed orders.</p></div> : <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Orders</th><th>Last seen</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id}><td><div className="product-name">{customer.name}</div><div className="field-hint">Customer {customer.id.slice(0, 8)}</div></td><td>{customer.phone}</td><td>{customer.orders}</td><td>{customer.lastSeenAt.toLocaleString()}</td></tr>)}</tbody></table></div>}</section></main>;
}
