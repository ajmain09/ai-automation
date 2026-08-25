import { notFound } from "next/navigation";
import { ControlCenter } from "@/components/settings/control-center";
import { getPreviewControlCenter } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";
import { getMetaControlCenter } from "@/services/meta/settings";

export const dynamic = "force-dynamic";
const sections = ["general", "meta", "security", "health"] as const;

export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const section = (await params).section;
  if (!sections.includes(section as (typeof sections)[number])) notFound();
  return <main className="workspace"><ControlCenter initial={isDevPreview() ? getPreviewControlCenter() : await getMetaControlCenter()} section={(section === "general" ? "overview" : section) as "overview" | "meta" | "security" | "health"} /></main>;
}
