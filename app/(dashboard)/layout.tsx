import { requireAdmin } from "@/lib/auth/session";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdmin();
  const section = "Operations";
  return <div className="app-shell"><Sidebar /><div className="main"><Topbar section={section} /><div data-admin={admin.email}>{children}</div></div></div>;
}
