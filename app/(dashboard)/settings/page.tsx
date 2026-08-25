import { ControlCenter } from "@/components/settings/control-center";
import { getPreviewControlCenter } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";
import { getMetaControlCenter } from "@/services/meta/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return <main className="workspace"><ControlCenter initial={isDevPreview() ? getPreviewControlCenter() : await getMetaControlCenter()} /></main>;
}
