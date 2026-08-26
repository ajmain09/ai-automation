"use client";

import { useState } from "react";

export function SystemTestButton() {
  const [message, setMessage] = useState("");
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  async function run() { setLoading(true); const response = await fetch("/api/system/health", { cache: "no-store" }); const body = await response.json(); setHealth(response.ok ? body : null); setMessage(response.ok ? "Health metrics refreshed." : body.error ?? "System health check failed."); setLoading(false); }
  const summary = health ? Object.entries(health).filter(([key]) => key !== "checkedAt").map(([key, value]) => { const state = typeof value === "object" && value !== null && "state" in value ? String((value as { state: unknown }).state) : "UNKNOWN"; const details = typeof value === "object" && value !== null ? Object.entries(value as Record<string, unknown>).filter(([field]) => field !== "state" && field !== "workers").map(([field, item]) => `${field}: ${item ?? "—"}`).join(" · ") : ""; return <div className="integration-card" key={key}><strong>{key}</strong><span className={`status-chip ${["HEALTHY", "ACTIVE"].includes(state) ? "green" : "gray"}`}><span className="dot" />{state}</span><small>{details}</small></div>; }) : null;
  return <div style={{ display: "grid", gap: 14 }}><button className="button secondary" onClick={run} disabled={loading}>{loading ? "Refreshing…" : "Refresh System Health"}</button>{summary && <div className="integration-grid">{summary}</div>}{message && <span className="field-hint">{message}</span>}</div>;
}
