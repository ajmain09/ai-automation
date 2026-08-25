"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function IssueActions({ issueId }: { issueId: string }) { const router = useRouter(); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); async function resolve() { setLoading(true); setError(""); const response = await fetch("/api/issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueId, action: "resolve" }) }); if (response.ok) router.refresh(); else { const body = await response.json().catch(() => null); setError(body?.error ?? "Unable to resolve issue."); } setLoading(false); } return <span className="row-actions"><button className="text-button" onClick={() => void resolve()} disabled={loading}>{loading ? "Resolving…" : "Resolve"}</button>{error && <span className="field-hint" role="alert">{error}</span>}</span>; }
