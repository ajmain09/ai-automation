import Link from "next/link";
import { getPages } from "@/services/pages/queries";

export const dynamic = "force-dynamic";

export default async function PagesPage() {
  const pages = await getPages();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">Workspace</div><h1>Pages</h1><p className="subtitle">Each Page has an isolated business, product, and configuration workspace.</p></div><Link href="/pages/new" className="button primary">Connect a page</Link></div>
    <section className="card"><div className="section-head"><div><h2>Managed pages</h2><span className="muted">{pages.length} page{pages.length === 1 ? "" : "s"} in this workspace</span></div></div>{pages.length === 0 ? <div className="empty-state"><h3>No pages connected yet</h3><p>Connect a Facebook Page to begin a three-step onboarding flow.</p><Link href="/pages/new" className="button primary">Connect a page</Link></div> : <div className="page-list" style={{ padding: 20 }}>{pages.map((page) => <PageCard key={page.id} page={page} />)}</div>}</section>
  </main>;
}

function PageCard({ page }: { page: Awaited<ReturnType<typeof getPages>>[number] }) {
  const latest = page.configurationVersions[0];
  return <article className="card page-card"><div className="page-card-top"><div className="page-ident"><div className="page-icon">{page.name.charAt(0).toUpperCase()}</div><div><div className="page-name">{page.name}</div><div className="page-id">{page.metaPageId ? `Meta Page ID · ${page.metaPageId}` : "Meta connection pending"}</div></div></div><span className={`status-chip ${page.connectionStatus === "CONNECTED" ? "green" : "gray"}`}><span className="dot" />{page.connectionStatus === "CONNECTED" ? "Connected" : "Not connected"}</span></div><div className="page-card-divider" /><div className="mini-stats"><div><div className="mini-label">Products</div><div className="mini-value">{page._count.products}</div></div><div><div className="mini-label">AI</div><div className="mini-value">{page.aiEnabled ? "On" : "Off"}</div></div><div><div className="mini-label">Configuration</div><div className="mini-value">{latest?.status === "LIVE" ? "Live" : "Draft"}</div></div></div><div className="card-footer"><span className="status-chip gray"><span className="dot" /> Page settings</span><Link href={`/pages/${page.slug}`} className="text-link">Open page →</Link></div></article>;
}
