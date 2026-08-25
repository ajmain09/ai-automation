import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageById } from "@/services/pages/queries";
import { getPreviewUsage } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";
import { PageControls } from "@/components/pages/page-controls";
import { PageTabs } from "@/components/pages/page-tabs";

export const dynamic = "force-dynamic";

export default async function PageWorkspace({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  const page = await getPageById(pageId);
  if (!page) notFound();
  const usage = isDevPreview() ? getPreviewUsage(page.id).month : { calls: 0, totalTokens: 0, estimatedCost: 0 };
  const live = page.configurationVersions.find((version) => version.status === "LIVE");
  const draft = page.configurationVersions.find((version) => version.status === "DRAFT");
  const activeProducts = page.products.filter((product) => product.active).length;
  return <main className="workspace">
    <div className="page-heading workspace-heading"><div className="page-ident workspace-ident"><div className="page-icon large">{page.name.charAt(0).toUpperCase()}</div><div><div className="eyebrow">Page workspace</div><h1>{page.name}</h1><div className="workspace-status"><span className={`status-chip ${page.connectionStatus === "CONNECTED" ? "green" : "gray"}`}><span className="dot" />Facebook · {page.connectionStatus === "CONNECTED" ? "Connected" : "Not connected"}</span><span className={`status-chip ${page.aiEnabled ? "green" : "gray"}`}><span className="dot" />AI · {page.aiEnabled ? "Live" : "Paused"}</span></div></div></div><PageControls pageId={page.id} pageSlug={page.slug} aiEnabled={page.aiEnabled} connectionStatus={page.connectionStatus} /></div>
    <PageTabs pageId={page.slug} active="Overview" />
    <section className="card operational-card"><div className="section-head"><div><h2>System status</h2><span className="muted">Live operating state for this Page</span></div></div><div className="status-grid"><StatusRow label="Facebook" value={page.connectionStatus === "CONNECTED" ? "Connected" : "Not connected"} /><StatusRow label="AI" value={page.aiEnabled ? "Live" : "Paused"} /><StatusRow label="Business" value={live ? "Published" : "Draft"} /><StatusRow label="Products" value={`${activeProducts} active`} /><StatusRow label="Telegram" value={page.settings?.telegramEnabled ? "Connected" : "Not configured"} /><StatusRow label="Live config" value={live ? `v${live.version}` : "—"} /></div></section>
    <div className="grid grid-2 overview-lower"><section className="card card-pad"><h2>Quick actions</h2><div className="quick-actions"><Link className="button secondary" href={`/pages/${page.slug}/business`}>Edit Business</Link><Link className="button secondary" href={`/pages/${page.slug}/products`}>Manage Products</Link><Link className="button secondary" href={`/pages/${page.slug}/ai`}>AI Settings</Link><Link className="button secondary" href={`/pages/${page.slug}/ai`}>Run Page Test</Link></div></section><section className="card card-pad"><h2>Configuration</h2><div className="config-lines"><div><span>Live version</span><strong>{live ? `v${live.version}` : "Not published"}</strong></div><div><span>Draft</span><strong>{draft ? "Pending changes" : "No pending changes"}</strong></div><div><span>AI usage this month</span><strong>{usage.calls} calls · {usage.totalTokens.toLocaleString()} tokens</strong></div></div></section></div>
    <section className="card card-pad"><div className="section-head inline-head"><div><h2>Active issue</h2><span className="muted">Only issues requiring operator attention appear here.</span></div><Link href="/issues" className="text-link">Open issues →</Link></div><p className="empty-inline">Everything else is running normally.</p></section>
  </main>;
}

function StatusRow({ label, value }: { label: string; value: string }) { return <div className="status-row"><span>{label}</span><strong>{value}</strong></div>; }
