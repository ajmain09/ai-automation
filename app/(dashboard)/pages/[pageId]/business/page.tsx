import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPageById } from "@/services/pages/queries";
import { BusinessEditor } from "@/components/pages/business-editor";
import { PageTabs } from "@/components/pages/page-tabs";
import { PublishDraftButton } from "@/components/pages/publish-draft-button";

export const dynamic = "force-dynamic";
export default async function BusinessPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params; const page = await getPageById(pageId); if (!page) notFound(); if (pageId !== page.slug) redirect(`/pages/${page.slug}/business`);
  const profile = page.businessProfile; const draft = page.configurationVersions.find((v) => v.status === "DRAFT");
  const data = draft?.businessData as { business_profile?: { business_name?: string | null; description?: string | null; benefits?: string[] }; policies?: { delivery?: string | null; cod?: string | null; faq?: string[] }; sales_instructions?: string | null; order_requirements?: string[] } | null;
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.slug}`}>{page.name}</Link> / Business</div><h1>Business setup</h1><p className="subtitle">Changes create a page-scoped draft. Live configuration remains unchanged until publish.</p></div><div className="page-actions"><span className="status-chip gray"><span className="dot" /> {draft ? "Draft" : "No pending changes"}</span>{draft && <PublishDraftButton pageId={page.id} />}</div></div><PageTabs pageId={page.slug} active="Business" /><BusinessEditor pageId={page.id} initial={{ businessName: data?.business_profile?.business_name ?? profile?.businessName ?? "", description: data?.business_profile?.description ?? profile?.description ?? "", benefits: data?.business_profile?.benefits?.join("\n") ?? toText(profile?.benefits), deliveryPolicy: data?.policies?.delivery ?? profile?.deliveryPolicy ?? "", codPolicy: data?.policies?.cod ?? profile?.codPolicy ?? "", faq: data?.policies?.faq?.join("\n") ?? toText(profile?.faq), salesInstructions: data?.sales_instructions ?? profile?.salesInstructions ?? "", notes: data?.order_requirements?.join("\n") ?? "", rawBusinessInfo: draft?.rawBusinessInfo ?? "" }} /></main>;
}
function toText(value: unknown) { if (!value) return ""; if (Array.isArray(value)) return value.join("\n"); return String(value); }
