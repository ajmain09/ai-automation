"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [["Dashboard", "/dashboard", "⌂"], ["Pages", "/pages", "▣"], ["Orders", "/orders", "□"], ["Issues", "/issues", "!"], ["Settings", "/settings", "⚙"]];

export function Sidebar() {
  const pathname = usePathname();
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">G</div><div><div className="brand-name">Growthifyx</div><span className="brand-sub">AI Sales Console</span></div></div>
    <div className="nav-section">Workspace</div>
    <nav className="nav" aria-label="Main navigation">{items.map(([label, href, icon]) => <Link className={`nav-link ${(pathname === href || (href !== "/dashboard" && pathname.startsWith(href))) ? "active" : ""}`} href={href} key={label}><span className="nav-icon">{icon}</span>{label}</Link>)}</nav>
    <div className="sidebar-bottom"><div className="nav-section" style={{ paddingLeft: 0 }}>System status</div><span className="status-chip green"><span className="dot" /> All systems normal</span></div>
  </aside>;
}
