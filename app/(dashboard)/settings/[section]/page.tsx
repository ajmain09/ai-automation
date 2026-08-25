import { notFound } from "next/navigation";
import { ControlCenter } from "@/components/settings/control-center";
import { getPreviewControlCenter } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";

export const dynamic = "force-dynamic";
const sections = ["integrations", "meta", "ai", "costs", "telegram", "security", "health"] as const;
const aliases = { integrations: "overview" } as const;

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const section = (await params).section;
  if (!sections.includes(section as (typeof sections)[number])) notFound();
  return <main className="workspace"><ControlCenter initial={isDevPreview() ? getPreviewControlCenter() : null} section={(aliases[section as keyof typeof aliases] ?? section) as "overview" | "meta" | "ai" | "costs" | "telegram" | "security" | "health"} /></main>;
}
