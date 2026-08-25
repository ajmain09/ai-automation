import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/auth/csrf";
import { requireAdmin } from "@/lib/auth/session";
import { isDevPreview } from "@/lib/env";
import { getPreviewControlCenter, setPreviewGlobalAiPaused, testPreviewMeta, updatePreviewMeta } from "@/services/preview/store";
import { getMetaControlCenter, saveMetaPlatformConfig, testMetaOAuthConfiguration, testMetaPlatformConfig } from "@/services/meta/settings";

const inputSchema = z.object({
  section: z.enum(["meta", "testMeta", "testOAuth", "pauseAllAi", "resumeAllAi"]),
  appId: z.string().trim().max(200).optional(), appSecret: z.string().trim().max(500).optional(), verifyToken: z.string().trim().max(500).optional(), graphApiVersion: z.string().trim().max(20).optional(), loginConfigurationId: z.string().trim().max(200).optional(),
});

export async function GET() {
  await requireAdmin();
  return NextResponse.json({ control: isDevPreview() ? getPreviewControlCenter() : await getMetaControlCenter() });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the control center fields." }, { status: 400 });
  const input = parsed.data;
  if (isDevPreview()) {
    if (input.section === "meta") updatePreviewMeta({ appId: input.appId ?? "", appSecret: input.appSecret, verifyToken: input.verifyToken, graphApiVersion: input.graphApiVersion, loginConfigurationId: input.loginConfigurationId });
    if (input.section === "testMeta") testPreviewMeta();
    if (input.section === "pauseAllAi") setPreviewGlobalAiPaused(true);
    if (input.section === "resumeAllAi") setPreviewGlobalAiPaused(false);
    return NextResponse.json({ ok: true, control: getPreviewControlCenter() });
  }
  const admin = await requireAdmin();
  if (input.section === "meta") return NextResponse.json({ ok: true, control: await saveMetaPlatformConfig({ appId: input.appId ?? "", appSecret: input.appSecret, verifyToken: input.verifyToken, graphApiVersion: input.graphApiVersion, loginConfigurationId: input.loginConfigurationId }, admin.id) });
  if (input.section === "testMeta") return NextResponse.json({ ok: true, control: await testMetaPlatformConfig(admin.id) });
  if (input.section === "testOAuth") return NextResponse.json({ ok: true, ...(await testMetaOAuthConfiguration(admin.id)) });
  return NextResponse.json({ error: "Global AI control is Page-scoped." }, { status: 410 });
}
