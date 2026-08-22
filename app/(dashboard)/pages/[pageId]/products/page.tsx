import { notFound } from "next/navigation";
import { getPageById } from "@/services/pages/queries";
import { ProductForm } from "@/components/pages/product-form";
import { PageTabs } from "@/components/pages/page-tabs";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params; const page = await getPageById(pageId); if (!page) notFound();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">{page.name} / Products</div><h1>Products & variants</h1><p className="subtitle">Build the page-scoped catalog. New catalog changes remain draft until publish.</p></div><ProductForm pageId={page.id} /></div><PageTabs pageId={page.id} active="Products" /><section className="card"><div className="section-head"><div><h2>Catalog</h2><span className="muted">{page.products.length} product{page.products.length === 1 ? "" : "s"} · active live catalog</span></div></div>{page.products.length === 0 ? <div className="empty-state"><h3>No products yet</h3><p>Add a product with its first variant to create a draft catalog.</p></div> : <div className="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Variant</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead><tbody>{page.products.flatMap((product) => product.variants.length ? product.variants.map((variant) => <tr key={variant.id}><td className="product-name">{product.name}</td><td>{variant.sku}</td><td>{[variant.size, variant.color].filter(Boolean).join(" · ") || "Default"}</td><td>{page.settings?.currency ?? "USD"} {Number(variant.currentPrice).toFixed(2)}</td><td>{variant.stockStatus.replaceAll("_", " ").toLowerCase()}</td><td><span className="status-chip green"><span className="dot" /> Active</span></td></tr>) : [<tr key={product.id}><td className="product-name">{product.name}</td><td>—</td><td>Awaiting variant</td><td>—</td><td>—</td><td><span className="status-chip gray"><span className="dot" /> Draft</span></td></tr>])}</tbody></table></div>}</section></main>;
}
