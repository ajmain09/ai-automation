import Link from "next/link";
import { getDashboardData } from "@/services/pages/queries";
import { getPreviewControlCenter, getPreviewGlobalAi } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { pages } = await getDashboardData();
  const control = isDevPreview() ? getPreviewControlCenter() : null;
  const globalPaused = isDevPreview() && getPreviewGlobalAi();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">Operations</div><h1>Dashboard</h1><p className="subtitle">A focused view of Page connection, AI state, and provider usage.</p></div><Link href="/pages/new" className="button primary">＋ Add Page</Link></div><div className="master-strip"><Status label="Meta" value={control?.meta.status ?? "Configured"} /><Status label="AI" value={control?.ai.status ?? "Configured"} /><Status label="Telegram" value={control?.telegram.status ?? "Configured"} /><Status label="System AI" value={globalPaused ? "Paused" : "Live"} /></div><section className="card" style={{ marginTop: 18 }}><div className="section-head"><div><h2>Managed Pages</h2><span className="muted">Each Page is isolated by its Meta Page ID.</span></div><Link href="/pages" className="text-link">View all Pages →</Link></div>{pages.length === 0 ? <div className="empty-state"><h3>No Pages connected</h3><p>Connect a Facebook Page to begin the three-step onboarding flow.</p><Link href="/pages/new" className="button primary">Connect a Page</Link></div> : <div className="page-dashboard-list">{pages.map((page) => <article className="page-dashboard-row" key={page.id}><div className="page-ident"><div className="page-icon">{page.name.charAt(0).toUpperCase()}</div><div><div className="page-name">{page.name}</div><div className="field-hint">Facebook · {page.connectionStatus === "CONNECTED" ? "Connected" : "Needs connection"}</div></div></div><div><div className="field-hint">AI</div><Status label={globalPaused ? "Paused globally" : page.aiEnabled ? "Live" : "Paused"} active={!globalPaused && page.aiEnabled} /></div><div><div className="field-hint">This month</div><strong>৳{page.usage.estimatedCostBdt.toFixed(2)}</strong><div className="field-hint">${page.usage.estimatedCost.toFixed(4)}</div></div><Link href={`/pages/${page.slug}`} className="button secondary">Manage</Link></article>)}</div>}</section></main>;
}

function Status({ label, value, active }: { label: string; value: string; active?: boolean }) { return <span className={`status-chip ${active ?? (value === "CONNECTED" || value === "READY" || value === "Live") ? "green" : "gray"}`}><span className="dot" />{label}{value && value !== label ? ` · ${value}` : ""}</span>; }
