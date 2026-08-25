import { notFound } from "next/navigation";
import { PageTabs } from "@/components/pages/page-tabs";
import { AiSettingsPanel } from "@/components/pages/ai-settings-panel";
import { getPageById } from "@/services/pages/queries";
import { getPreviewAiSettings } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";
import { PageBudgetControl } from "@/components/pages/page-budget-control";

export const dynamic = "force-dynamic";

export default async function AiPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params; const page = await getPageById(pageId); if (!page) notFound();
  const settings = isDevPreview() ? getPreviewAiSettings(page.id) : { language: "auto", tone: "natural_sales", replyLength: "short", understandBeforeRecommend: true, avoidRepeatedQuestions: true as const, maxProductsPerRecommendation: 1 as const, suggestCombo: true, askOneQuestionAtATime: true, mirrorCustomerLanguage: true, customerMemory: true, recentMessageContext: 12, rollingSummary: true, smartBuffer: true, bufferWindowSeconds: 8, manualCollisionProtection: true, manualActivityCooldownSeconds: 30, staleReplyProtection: true as const, sequentialProcessing: true as const, customSalesInstructions: "" };
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">{page.name} / AI</div><h1>AI customization</h1><p className="subtitle">Tune this Page behavior while protected safety and reliability rules stay locked.</p></div><span className={`status-chip ${page.aiEnabled ? "green" : "gray"}`}><span className="dot" />AI {page.aiEnabled ? "Live" : "Paused"}</span></div><PageTabs pageId={page.slug} active="AI" /><AiSettingsPanel pageId={page.slug} initial={settings} aiEnabled={page.aiEnabled} /><PageBudgetControl pageId={page.slug} /></main>;
}
