import { notFound, redirect } from "next/navigation";
import { PageTabs } from "@/components/pages/page-tabs";
import { AiSettingsPanel } from "@/components/pages/ai-settings-panel";
import { getPageById } from "@/services/pages/queries";
import { getPreviewAiSettings } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";
import { PageBudgetControl } from "@/components/pages/page-budget-control";

export const dynamic = "force-dynamic";

export default async function AiPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params; const page = await getPageById(pageId); if (!page) notFound(); if (pageId !== page.slug) redirect(`/pages/${page.slug}/ai`);
  const persistedAi = "aiSettings" in page ? page.aiSettings : null;
  const settings = isDevPreview() ? getPreviewAiSettings(page.id) : { language: persistedAi?.language ?? "auto", tone: persistedAi?.tone ?? "natural_sales", replyLength: persistedAi?.replyLength ?? "short", provider: "deepseek", apiKeyConfigured: Boolean(persistedAi?.encryptedApiKey), accountLabel: "Page DeepSeek account", providerStatus: persistedAi?.status ?? "NOT_CONFIGURED", providerBalanceUsd: persistedAi?.providerBalanceUsd ? Number(persistedAi.providerBalanceUsd) : null, providerBalanceCny: persistedAi?.providerBalanceCny ? Number(persistedAi.providerBalanceCny) : null, understandBeforeRecommend: persistedAi?.understandBeforeRecommend ?? true, avoidRepeatedQuestions: true as const, maxProductsPerRecommendation: 1 as const, suggestCombo: persistedAi?.suggestCombo ?? true, askOneQuestionAtATime: persistedAi?.askOneQuestionAtATime ?? true, mirrorCustomerLanguage: persistedAi?.mirrorCustomerLanguage ?? true, customerMemory: persistedAi?.customerMemory ?? true, recentMessageContext: persistedAi?.recentMessageContext ?? 12, rollingSummary: persistedAi?.rollingSummary ?? true, smartBuffer: persistedAi?.smartBuffer ?? true, bufferWindowSeconds: persistedAi?.bufferWindowSeconds ?? 8, manualCollisionProtection: persistedAi?.manualCollisionProtection ?? true, manualActivityCooldownSeconds: persistedAi?.manualActivityCooldown ?? 30, staleReplyProtection: true as const, sequentialProcessing: true as const, customSalesInstructions: persistedAi?.customSalesInstructions ?? "", modelOverride: persistedAi?.model as "deepseek-v4-flash" | "deepseek-v4-pro" | undefined, thinking: persistedAi?.thinkingOverride as "off" | "on" | undefined, maxOutputTokens: persistedAi?.maxOutputTokens ?? 700 };
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow">{page.name} / AI</div><h1>AI customization</h1><p className="subtitle">Tune this Page behavior while protected safety and reliability rules stay locked.</p></div><span className={`status-chip ${page.aiEnabled ? "green" : "gray"}`}><span className="dot" />AI {page.aiEnabled ? "Live" : "Paused"}</span></div><PageTabs pageId={page.slug} active="AI" /><AiSettingsPanel pageId={page.slug} initial={settings} aiEnabled={page.aiEnabled} /><PageBudgetControl pageId={page.slug} /></main>;
}
