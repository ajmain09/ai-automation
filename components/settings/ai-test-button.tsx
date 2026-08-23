"use client";

import { useState } from "react";

export function AiTestButton() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function run() {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await response.json();
      setMessage(response.ok ? `DeepSeek response: ${body.content}` : body.error ?? "DeepSeek test failed.");
    } catch { setMessage("Unable to run the DeepSeek test."); } finally { setLoading(false); }
  }
  return <div style={{ display: "grid", gap: 8, justifyItems: "start" }}><button className="button secondary" onClick={run} disabled={loading}>{loading ? "Testing…" : "Test AI"}</button>{message && <span className="field-hint" role="status">{message}</span>}</div>;
}
