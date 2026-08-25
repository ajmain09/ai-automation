"use client";

import Link from "next/link";
import { useState } from "react";

export function PageControls({ pageId, pageSlug, aiEnabled, connectionStatus }: { pageId: string; pageSlug: string; aiEnabled: boolean; connectionStatus: string }) {
  const [on, setOn] = useState(aiEnabled); const [loading, setLoading] = useState(false); const [notice, setNotice] = useState("");
  async function toggle() { setLoading(true); const response = await fetch(`/api/pages/${pageId}/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !on }) }); const body = await response.json().catch(() => null); if (response.ok) setOn(Boolean(body.enabled)); else setNotice(body?.error ?? "Unable to update AI."); setLoading(false); }
  async function testFacebook() { setLoading(true); const response = await fetch("/api/meta/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId }) }); const body = await response.json().catch(() => null); setNotice(response.ok ? "Facebook connection is healthy." : body?.error ?? "Facebook connection needs attention."); setLoading(false); }
  return <div className="page-actions"><button className="button primary" onClick={toggle} disabled={loading}>{loading ? "Updating…" : on ? "Pause AI" : "Start AI"}</button><details className="action-menu"><summary className="button secondary">More</summary><div className="action-menu-popover">{connectionStatus === "CONNECTED" ? <button onClick={testFacebook} disabled={loading}>Test Facebook</button> : <Link href={`/pages/new?reconnect=${pageId}`}>Reconnect Facebook</Link>}<Link href={`/pages/${pageSlug}/ai`}>Test AI</Link><Link href={`/pages/${pageSlug}/telegram`}>Test Telegram</Link><Link href={`/pages/${pageSlug}/settings`}>Settings</Link></div></details>{notice && <span className="field-hint" role="status">{notice}</span>}</div>;
}
