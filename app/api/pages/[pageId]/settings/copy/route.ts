import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { isDevPreview } from "@/lib/env";
import { copyPreviewSettings, getPreviewPage, safeSettingsCopyFields } from "@/services/preview/store";

const schema = z.object({ fromPageId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  if (!isDevPreview()) return NextResponse.json({ error: "Safe settings copy requires the configured database runtime." }, { status: 501 });
  const pageId = (await params).pageId;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success || !getPreviewPage(pageId) || !getPreviewPage(parsed.data.fromPageId)) return NextResponse.json({ error: "Choose two valid Pages." }, { status: 400 });
  return NextResponse.json({ ok: true, fields: safeSettingsCopyFields, result: copyPreviewSettings(parsed.data.fromPageId, pageId) });
}
