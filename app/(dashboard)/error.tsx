"use client";

import Link from "next/link";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="workspace"><section className="card card-pad app-not-found"><div className="eyebrow">Workspace</div><h1>Something needs attention</h1><p className="subtitle">The workspace could not load this view. Your saved configuration is unchanged.</p><div className="form-actions"><button className="button primary" onClick={() => reset()}>Try again</button><Link href="/dashboard" className="button secondary">Back to dashboard</Link></div></section></main>;
}
