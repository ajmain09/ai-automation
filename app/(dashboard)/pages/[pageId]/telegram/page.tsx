import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageTabs } from "@/components/pages/page-tabs";
import { TelegramSettingsPanel } from "@/components/pages/telegram-settings-panel";
import { getPageById } from "@/services/pages/queries";
import { getPreviewTelegramSettings } from "@/services/preview/store";
import { getPageTelegramSettings } from "@/services/telegram/service";
import { isDevPreview } from "@/lib/env";

export const dynamic = "force-dynamic";
export default async function TelegramPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params; const page = await getPageById(pageId); if (!page) notFound(); if (pageId !== page.slug) redirect(`/pages/${page.slug}/telegram`);
  const settings = isDevPreview() ? getPreviewTelegramSettings(page.id) : await getPageTelegramSettings(page.id);
  const initial = settings ? { tokenConfigured: settings.tokenConfigured, accountLabel: "Page Telegram account", chatId: settings.chatId ?? "", newOrderEnabled: settings.newOrderEnabled, updatedOrderEnabled: settings.updatedOrderEnabled, cancelledOrderEnabled: settings.cancelledOrderEnabled, status: settings.status } : { tokenConfigured: false, chatId: "", newOrderEnabled: true, updatedOrderEnabled: true, cancelledOrderEnabled: true, status: "NOT_CONFIGURED" };
  return <main className="workspace"><div className="page-heading"><div><div className="eyebrow"><Link href={`/pages/${page.slug}`}>{page.name}</Link> / Telegram</div><h1>Telegram</h1><p className="subtitle">Configure notifications for this Page only.</p></div></div><PageTabs pageId={page.slug} active="Telegram" /><TelegramSettingsPanel pageId={page.id} initial={initial} /></main>;
}
