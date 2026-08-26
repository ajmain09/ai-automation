import { NextResponse } from "next/server";
import { authenticateAdmin, clearLoginRateLimit, createSession, loginRateLimit, recordFailedLogin, trustedClientKey } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation/auth";

export async function POST(request: Request) {
  const clientKey = trustedClientKey(request);
  const limit = await loginRateLimit(clientKey);
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const body = Object.fromEntries(await request.formData());
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  const admin = await authenticateAdmin(parsed.data.email, parsed.data.password);
  if (!admin) { await recordFailedLogin(clientKey, parsed.data.email); return NextResponse.json({ error: "Invalid email or password." }, { status: 401 }); }
  await clearLoginRateLimit(clientKey); await createSession(admin.id); return NextResponse.json({ ok: true });
}
