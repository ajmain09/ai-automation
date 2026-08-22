"use client";

import { useState } from "react";

export function SystemTestButton({ pageId }: { pageId?: string }) {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function run() { setLoading(true); const response = await fetch("/api/health/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pageId ? { pageId } : {}) }); const body = await response.json(); setMessage(response.ok ? `${body.results.length} checks completed${body.mocked ? " (mocked locally)" : ""}.` : body.error ?? "System test failed."); setLoading(false); }
  return <div style={{ display: "grid", gap: 8, justifyItems: "start" }}><button className="button secondary" onClick={run} disabled={loading}>{loading ? "Testing…" : "Run System Test"}</button>{message && <span className="field-hint">{message}</span>}</div>;
}
