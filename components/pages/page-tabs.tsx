import Link from "next/link";

const tabs = ["Overview", "Business", "Products", "Conversations", "Customers", "Orders", "AI Usage", "Settings"] as const;
const paths: Record<(typeof tabs)[number], string> = { Overview: "", Business: "/business", Products: "/products", Conversations: "/conversations", Customers: "/customers", Orders: "/orders", "AI Usage": "/usage", Settings: "/settings" };

export function PageTabs({ pageId, active }: { pageId: string; active: (typeof tabs)[number] }) {
  return <nav className="tabs" aria-label="Page navigation">{tabs.map((tab) => paths[tab] ? <Link key={tab} className={`tab ${active === tab ? "active" : ""}`} href={`/pages/${pageId}${paths[tab]}`}>{tab}</Link> : <span key={tab} className={`tab ${active === tab ? "active" : ""}`} aria-disabled="true">{tab}</span>)}</nav>;
}
