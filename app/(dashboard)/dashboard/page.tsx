import Link from "next/link";
import { getDashboardData } from "@/services/pages/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { pages } = await getDashboardData();
  return <main className="workspace">
    <div className="page-heading"><div><div className="eyebrow">Operations</div><h1>Dashboard</h1><p className="subtitle">Page connection, AI state, and usage for the current month.</p></div><Link href="/pages/new" className="button primary">Connect a page</Link></div>
    <section className="card"><div className="section-head"><div><h2>Managed Pages</h2><span className="muted">Every Page is isolated by Meta Page ID.</span></div></div>
      {pages.length === 0 ? <div className="empty-state"><h3>No Pages connected</h3><p>Connect a Facebook Page to begin the three-step onboarding flow.</p><Link href="/pages/new" className="button primary">Connect a page</Link></div> : <div className="table-wrap"><table><thead><tr><th>Page Name</th><th>Facebook status</th><th>AI status</th><th>AI API usage this month</th><th aria-label="Actions" /></tr></thead><tbody>{pages.map((page) => <tr key={page.id}><td className="product-name">{page.name}</td><td><Status label={page.connectionStatus === "CONNECTED" ? "Connected" : "Not connected"} active={page.connectionStatus === "CONNECTED"} /></td><td><Status label={page.aiEnabled ? "Enabled" : "Paused"} active={page.aiEnabled} /></td><td>{page.usage.calls} calls · {page.usage.totalTokens.toLocaleString()} tokens</td><td><Link href={`/pages/${page.id}`} className="button secondary">Manage</Link></td></tr>)}</tbody></table></div>}
    </section>
  </main>;
}

function Status({ label, active }: { label: string; active: boolean }) {
  return <span className={`status-chip ${active ? "green" : "gray"}`}><span className="dot" />{label}</span>;
}
