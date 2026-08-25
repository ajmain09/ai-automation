import Link from "next/link";

export default function DashboardNotFound() { return <main className="workspace"><section className="card card-pad app-not-found"><div className="eyebrow">Workspace</div><h1>Page not found</h1><p className="subtitle">The Page may have been removed or the link is no longer valid.</p><Link href="/pages" className="button primary">Back to Pages</Link></section></main>; }
