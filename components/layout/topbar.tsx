import { logout } from "@/lib/auth/session";

export function Topbar({ section }: { section: string }) {
  return <header className="topbar"><div className="breadcrumb"><strong>Growthifyx</strong><span> / {section}</span></div><div className="top-actions"><span className="status-chip gray"><span className="dot" /> Private admin console</span><div className="admin-avatar">SA</div><form action={logout}><button className="button ghost" type="submit">Sign out</button></form></div></header>;
}
