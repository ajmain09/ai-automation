import { NextResponse } from "next/server";
import { authenticateAdmin, createSession } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validation/auth";

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now(); const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= 8) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  const body = Object.fromEntries(await request.formData());
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
  const admin = await authenticateAdmin(parsed.data.email, parsed.data.password);
  if (!admin) { attempts.set(ip, { count: (current?.count ?? 0) + 1, resetAt: current?.resetAt && current.resetAt > now ? current.resetAt : now + 5 * 60 * 1000 }); return NextResponse.json({ error: "Invalid email or password." }, { status: 401 }); }
  attempts.delete(ip); await createSession(admin.id); return NextResponse.json({ ok: true });
}
