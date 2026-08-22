"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [["Dashboard", "/dashboard", "dashboard"], ["Pages", "/pages", "pages"], ["Orders", "/orders", "orders"], ["Issues", "/issues", "issues"], ["Settings", "/settings", "settings"]] as const;

function Icon({ name }: { name: (typeof items)[number][2] }) {
  const paths = { dashboard: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z", pages: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5", orders: "M4 5h16v14H4zM8 9h8M8 13h5", issues: "M12 4l8 16H4L12 4zM12 10v4M12 17h.01", settings: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0" } as const;
  return <svg className="nav-svg" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Sidebar() {
  const pathname = usePathname();
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">G</div><div><div className="brand-name">Growthifyx</div><span className="brand-sub">AI Sales Console</span></div></div>
    <div className="nav-section">Workspace</div>
    <nav className="nav" aria-label="Main navigation">{items.map(([label, href, icon]) => <Link className={`nav-link ${(pathname === href || (href !== "/dashboard" && pathname.startsWith(href))) ? "active" : ""}`} href={href} key={label}><span className="nav-icon"><Icon name={icon} /></span>{label}</Link>)}</nav>
    <div className="sidebar-bottom"><div className="nav-section" style={{ paddingLeft: 0 }}>System status</div><span className="status-chip gray"><span className="dot" /> Operator console</span></div>
  </aside>;
}
