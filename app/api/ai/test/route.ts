import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/auth/csrf";
import { getEnv, isDevPreview } from "@/lib/env";
import { DeepSeekProvider } from "@/services/ai/provider";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  await requireAdmin();
  if (!isDevPreview()) return NextResponse.json({ error: "Development preview is not enabled." }, { status: 404 });
  const env = getEnv();
  if (!env.DEEPSEEK_API_KEY) return NextResponse.json({ configured: false, error: "DeepSeek not configured" }, { status: 503 });
  try {
    const result = await new DeepSeekProvider().complete({ callType: "PRELIVE_TEST", system: "Return a short JSON object with a greeting and a one-sentence status.", user: "This is a local development AI connectivity test. Do not include secrets." });
    return NextResponse.json({ configured: true, content: result.content, usage: result.usage ?? null });
  } catch (error) {
    return NextResponse.json({ configured: true, error: error instanceof Error ? error.message : "DeepSeek test failed." }, { status: 502 });
  }
}
