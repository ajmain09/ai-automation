"use client";

import { useState } from "react";

export function DataDeletionForm() {
  const [pageId, setPageId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/data-deletion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId, customerId, requestKey, confirm: confirmed }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Deletion request failed.");
      setMessage(body.result.alreadyCompleted ? "This deletion request was already completed safely." : `Deletion completed. ${body.result.ordersPreserved} order record(s) were preserved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Deletion request failed."); }
    finally { setBusy(false); }
  }
  return <section className="card card-pad"><h2>Execute a verified deletion request</h2><p className="policy-copy">This administrative action removes non-required customer memory and conversation data. Preserved order records are anonymized and are never removed by this action.</p><div className="form-grid" style={{ marginTop: 18 }}><label className="field"><span>Meta Page ID / internal Page ID</span><input className="input" value={pageId} onChange={(event) => setPageId(event.target.value)} /></label><label className="field"><span>Customer ID</span><input className="input" value={customerId} onChange={(event) => setCustomerId(event.target.value)} /></label><label className="field"><span>Request key</span><input className="input" value={requestKey} onChange={(event) => setRequestKey(event.target.value)} placeholder="meta-request-..." /></label><label className="setting-toggle" style={{ alignItems: "flex-start" }}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I verified the Page/customer scope and want to execute this request.</span></label><div className="form-actions"><button className="button danger" disabled={busy || !confirmed || !pageId || !customerId || !requestKey} onClick={() => void submit()}>{busy ? "Executing…" : "Execute deletion"}</button></div></div>{message && <div className="callout info" role="status" style={{ marginTop: 14 }}>{message}</div>}</section>;
}
