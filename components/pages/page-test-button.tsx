"use client";

import { useState } from "react";

type Check = { key: string; label: string; ok: boolean; detail: string };

export function PageTestButton({ pageId }: { pageId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ready: boolean; checks: Check[] } | null>(null);
  const [error, setError] = useState("");
  async function run() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/pages/${pageId}/readiness`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to run Page test.");
      setResult(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to run Page test."); }
    finally { setLoading(false); }
  }
  return <div className="page-test-control"><button className="button secondary" onClick={() => void run()} disabled={loading}>{loading ? "Testing…" : "Run Page Test"}</button>{result && <div className="page-test-result" role="status"><strong>{result.checks.filter((check) => check.ok).length}/{result.checks.length} passed · {result.ready ? "READY" : "NEEDS ATTENTION"}</strong><div className="locked-list">{result.checks.map((check) => <span key={check.key} className={check.ok ? "" : "field-hint"}>{check.ok ? "READY" : "NEEDS ATTENTION"} · {check.label}{check.ok ? "" : ` · ${check.detail}`}</span>)}</div></div>}{error && <span className="field-hint" role="alert">{error}</span>}</div>;
}
