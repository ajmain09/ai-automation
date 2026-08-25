import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/services/meta/service";
import { ingestMetaWebhook } from "@/services/meta/webhook";
import { PostgresJobQueue } from "@/services/jobs/queue";
import { isDevPreview } from "@/lib/env";
import { getMetaPlatformConfig } from "@/services/meta/settings";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (isDevPreview()) return challenge ? new Response(challenge, { status: 200 }) : NextResponse.json({ ok: true, mocked: true });
  const config = await getMetaPlatformConfig();
  if (mode === "subscribe" && token && token === config.verifyToken && challenge) return new Response(challenge, { status: 200 });
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  if (isDevPreview()) return NextResponse.json({ accepted: true, mocked: true });
  const raw = await request.text();
  const config = await getMetaPlatformConfig();
  const signature = request.headers.get("x-hub-signature-256");
  const valid = config.appSecret ? verifyWebhookSignature(raw, signature, config.appSecret) : false;
  if (!valid) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 403 });
  try {
    const result = await ingestMetaWebhook(raw, JSON.parse(raw), new PostgresJobQueue(), true);
    return NextResponse.json(result, { status: 200 });
  } catch {
    const requestId = crypto.randomUUID();
    return NextResponse.json({ error: "Webhook accepted for retry.", requestId }, { status: 202 });
  }
}
