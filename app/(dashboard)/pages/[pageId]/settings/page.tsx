import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageById } from "@/services/pages/queries";
import { PageSettingsForm } from "@/components/pages/page-settings-form";
import { PageTabs } from "@/components/pages/page-tabs";

export const dynamic = "force-dynamic";
export default async function PageSettingsPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params; const page = await getPageById(pageId); if (!page) notFound();
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.slug}`}>{page.name}</Link> / Settings</div><h1>Page settings</h1><p className="subtitle">Configure defaults and required order fields for this Page.</p></div></div><PageTabs pageId={page.slug} active="Settings" /><PageSettingsForm pageId={page.slug} initial={{ currency: page.settings?.currency ?? "USD", countryCode: page.settings?.countryCode ?? "US", defaultLanguage: page.settings?.defaultLanguage ?? "en", tone: page.settings?.tone ?? "helpful", requiredOrderFields: Array.isArray(page.settings?.requiredOrderFields) ? page.settings.requiredOrderFields.map(String) : ["name", "phone", "address", "product", "variant", "quantity"] }} /></main>;
}
