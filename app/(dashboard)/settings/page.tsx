import { prisma } from "@/lib/db/prisma";
import { GlobalControls } from "@/components/settings/global-controls";
import { getSystemHealth } from "@/services/health/service";
import { SystemTestButton } from "@/components/settings/system-test-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: "global_ai_paused" } });
  const paused = setting?.value === true;
  const health = await getSystemHealth();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">Workspace</div><h1>Settings</h1><p className="subtitle">Safety controls and simple system health for the private operator console.</p></div></div><div className="grid grid-2"><section className="card"><div className="section-head"><div><h2>AI safety</h2><span className="muted">Global and per-page controls</span></div></div><div className="card-content"><GlobalControls paused={paused} /><div className="callout warning" style={{ marginTop: 20 }}><span className="callout-icon">!</span><span>Pausing AI does not disable webhook or message storage. It only prevents AI processing and automatic replies.</span></div></div></section><section className="card"><div className="section-head"><div><h2>System health</h2><span className="muted">Provider state, not an analytics dashboard</span></div></div><div className="card-content">{health.map((item) => <div className="card-footer" key={item.component} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}><div><div style={{ fontSize: 12, fontWeight: 650 }}>{item.component}</div><div className="field-hint">{item.detail}</div></div><span className={`status-chip ${item.state === "HEALTHY" ? "green" : item.state === "PAUSED" ? "gray" : item.state === "DEGRADED" ? "amber" : "red"}`}><span className="dot" />{item.state}</span></div>)}<div style={{ marginTop: 18 }}><SystemTestButton /></div></div></section></div></main>;
}
