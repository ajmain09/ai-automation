import { ControlCenter } from "@/components/settings/control-center";
import { GlobalControls } from "@/components/settings/global-controls";
import { getPreviewControlCenter, getPreviewGlobalAi } from "@/services/preview/store";
import { isDevPreview } from "@/lib/env";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const paused = isDevPreview() ? getPreviewGlobalAi() : (await prisma.systemSetting.findUnique({ where: { key: "global_ai_paused" } }))?.value === true;
  return <main className="workspace"><div className="card card-pad" style={{ marginBottom: 20 }}><GlobalControls paused={paused} /></div><ControlCenter initial={isDevPreview() ? getPreviewControlCenter() : null} /></main>;
}
