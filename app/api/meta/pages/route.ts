import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { decryptCredential } from "@/lib/encryption/service";
import { discoverPages } from "@/services/meta/service";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { isDevPreview } from "@/lib/env";

export async function GET(request: Request) {
  await requireAdmin();
  if (isDevPreview()) return NextResponse.json({ pages: [{ id: "preview-meta-page-001", name: "Growthifyx Demo Page" }], state: "preview" });
  const state = z.string().min(20).safeParse(new URL(request.url).searchParams.get("state"));
  if (!state.success) return NextResponse.json({ error: "Invalid OAuth state." }, { status: 400 });
  const hash = (await import("node:crypto")).createHash("sha256").update(state.data).digest("hex");
  const record = await prisma.oAuthState.findUnique({ where: { stateHash: hash } });
  if (!record?.encryptedUserToken || record.expiresAt < new Date()) return NextResponse.json({ error: "OAuth session expired." }, { status: 400 });
  try { return NextResponse.json({ pages: await discoverPages(decryptCredential(record.encryptedUserToken)), state: state.data }); }
  catch { return NextResponse.json({ error: "Unable to discover Facebook Pages." }, { status: 502 }); }
}
