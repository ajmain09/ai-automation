"use client";

import { useState } from "react";

export function CopySettingsControl({ pageId, pages }: { pageId: string; pages: Array<{ id: string; name: string }> }) {
  const choices = pages.filter((page) => page.id !== pageId);
  const [fromPageId, setFromPageId] = useState(choices[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function copy() { setLoading(true); const response = await fetch(`/api/pages/${pageId}/settings/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromPageId }) }); const body = await response.json().catch(() => null); setMessage(response.ok ? `Copied ${body.fields.length} safe fields. Secrets, business, products, customers, orders, and usage were not copied.` : body?.error ?? "Unable to copy settings."); setLoading(false); if (response.ok) setOpen(false); }
  if (choices.length === 0) return null;
  return <div className="copy-settings-control"><button className="button secondary" onClick={() => setOpen(!open)}>Copy Settings From Another Page</button>{open && <div className="inline-editor" role="dialog"><strong>Safe settings copy</strong><span className="field-hint">Only AI behavior, memory, message handling, order fields, and the budget warning percentage will be copied.</span><select className="input" value={fromPageId} onChange={(event) => setFromPageId(event.target.value)}>{choices.map((page) => <option value={page.id} key={page.id}>{page.name}</option>)}</select><div className="form-actions"><button className="button ghost" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" onClick={() => void copy()} disabled={loading || !fromPageId}>{loading ? "Copying…" : "Apply"}</button></div></div>}{message && <span className="field-hint" role="status">{message}</span>}</div>;
}
