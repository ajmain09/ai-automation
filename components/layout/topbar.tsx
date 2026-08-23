import { logout } from "@/lib/auth/session";
import { isDevPreview } from "@/lib/env";

async function logoutAction() {
  "use server";
  await logout();
}

export function Topbar({ section }: { section: string }) {
  return <header className="topbar"><div className="breadcrumb"><strong>Growthifyx</strong><span> / {section}</span></div><div className="top-actions"><span className="status-chip gray"><span className="dot" /> Private admin console</span><div className="admin-avatar">SA</div>{isDevPreview() ? <span className="button ghost" aria-label="Sign out unavailable in preview">Preview mode</span> : <form action={logoutAction}><button className="button ghost" type="submit">Sign out</button></form>}</div></header>;
}
