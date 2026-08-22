import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { verifyWebhookSignature } from "@/services/meta/service";
import { ingestMetaWebhook } from "@/services/meta/webhook";
import { PostgresJobQueue } from "@/services/jobs/queue";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === getEnv().META_VERIFY_TOKEN && challenge) return new Response(challenge, { status: 200 });
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  const raw = await request.text();
  const env = getEnv();
  const signature = request.headers.get("x-hub-signature-256");
  const valid = env.META_APP_SECRET ? verifyWebhookSignature(raw, signature, env.META_APP_SECRET) : env.NODE_ENV !== "production";
  if (!valid) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 403 });
  try {
    const result = await ingestMetaWebhook(raw, JSON.parse(raw), new PostgresJobQueue(), true);
    return NextResponse.json(result, { status: 200 });
  } catch {
    const requestId = crypto.randomUUID();
    return NextResponse.json({ error: "Webhook accepted for retry.", requestId }, { status: 202 });
  }
}
