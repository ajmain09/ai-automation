import Link from "next/link";
import { getDashboardData } from "@/services/pages/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { pages, stats } = await getDashboardData();
  return <main className="workspace">
    <div className="page-heading"><div><div className="eyebrow">Operations overview</div><h1>Good morning, Admin</h1><p className="subtitle">A clear view of your pages, configuration, and sales readiness.</p></div><Link href="/pages/new" className="button primary">＋ Connect a page</Link></div>
    <div className="grid grid-4" style={{ marginBottom: 24 }}>
      <div className="card metric"><div className="metric-label">Managed pages</div><div className="metric-value">{stats.pages}</div><div className="metric-note">Facebook pages in workspace</div></div>
      <div className="card metric"><div className="metric-label">Live configurations</div><div className="metric-value">{stats.live}</div><div className="metric-note">Ready for future activation</div></div>
      <div className="card metric"><div className="metric-label">Products configured</div><div className="metric-value">{stats.products}</div><div className="metric-note">Across all pages</div></div>
      <div className="card metric"><div className="metric-label">AI API usage</div><div className="metric-value">—</div><div className="metric-note">Available when AI is connected</div></div>
    </div>
    <section className="card"><div className="section-head"><div><h2>Pages</h2><span className="muted">Manage each page’s isolated business workspace</span></div><Link href="/pages" className="text-link">View all →</Link></div>
      {pages.length === 0 ? <div className="empty-state"><div className="empty-icon">＋</div><h3>Connect your first page</h3><p>Facebook connection is prepared as a future integration boundary. You can start your business setup now.</p><Link href="/pages/new" className="button primary">Connect a page</Link></div> : <div className="page-list" style={{ padding: 20 }}>{pages.map((page) => <PageSummary key={page.id} page={page} />)}</div>}
    </section>
  </main>;
}

function PageSummary({ page }: { page: { id: string; name: string; connectionStatus: string; aiEnabled: boolean; products: number; config: string } }) {
  return <article className="card page-card"><div className="page-card-top"><div className="page-ident"><div className="page-icon">{page.name.charAt(0).toUpperCase()}</div><div><div className="page-name">{page.name}</div><div className="page-id">Facebook Page · {page.connectionStatus.toLowerCase()}</div></div></div><span className={`status-chip ${page.connectionStatus === "CONNECTED" ? "green" : "gray"}`}><span className="dot" />{page.connectionStatus === "CONNECTED" ? "Connected" : "Not connected"}</span></div><div className="page-card-divider" /><div className="mini-stats"><div><div className="mini-label">AI status</div><div className="mini-value">{page.aiEnabled ? "Enabled" : "Paused"}</div></div><div><div className="mini-label">Products</div><div className="mini-value">{page.products}</div></div><div><div className="mini-label">Config</div><div className="mini-value">{page.config}</div></div></div><div className="card-footer"><span className="status-chip amber"><span className="dot" /> AI usage placeholder</span><Link href={`/pages/${page.id}`} className="text-link">Manage →</Link></div></article>;
}
