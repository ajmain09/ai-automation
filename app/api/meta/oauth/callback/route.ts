import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { consumeOAuthState, exchangeCode } from "@/services/meta/service";
import { encryptCredential } from "@/lib/encryption/service";

export async function GET(request: Request) {
  await requireAdmin();
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return NextResponse.json({ error: "Missing OAuth callback parameters." }, { status: 400 });
  try {
    const record = await consumeOAuthState(state);
    const token = await exchangeCode(code, record.redirectUri);
    const hash = (await import("node:crypto")).createHash("sha256").update(state).digest("hex");
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.oAuthState.update({ where: { stateHash: hash }, data: { encryptedUserToken: encryptCredential(token.access_token) } });
    return NextResponse.redirect(new URL(`/pages/new?meta_state=${encodeURIComponent(state)}`, url.origin));
  } catch {
    return NextResponse.json({ error: "Facebook connection could not be completed." }, { status: 400 });
  }
}
