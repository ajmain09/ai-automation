import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "@/lib/db/prisma";
import { getEnv, isDevPreview } from "@/lib/env";
import { logger } from "@/lib/logging/logger";

const COOKIE = "gx_session";
const SESSION_TTL = 60 * 60 * 8;
const PREVIEW_ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const previewAdmin = { id: PREVIEW_ADMIN_ID, email: "admin@local.test", passwordHash: "preview-only", name: "Local Preview Admin", lastLoginAt: null, createdAt: new Date(0), updatedAt: new Date(0) };

function sign(value: string) { return createHmac("sha256", getEnv().SESSION_SECRET!).update(value).digest("base64url"); }

export async function createSession(adminId: string) {
  const token = `${adminId}.${randomUUID()}.${Date.now()}`;
  const signed = `${token}.${sign(token)}`;
  (await cookies()).set(COOKIE, signed, { httpOnly: true, secure: getEnv().NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL });
}

export async function getCurrentAdmin() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 4) return null;
  const signature = parts.pop();
  const token = parts.join(".");
  if (!signature) return null;
  const expected = sign(token);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const issuedAt = Number(parts[2]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL * 1000) return null;
  if (isDevPreview()) return parts[0] === previewAdmin.id ? { ...previewAdmin, email: getEnv().PREVIEW_ADMIN_EMAIL! } : null;
  return prisma.admin.findUnique({ where: { id: parts[0] } });
}

export async function requireAdmin() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");
  return admin;
}

export async function authenticateAdmin(email: string, password: string) {
  if (isDevPreview()) {
    const env = getEnv();
    const valid = email.trim().toLowerCase() === env.PREVIEW_ADMIN_EMAIL!.trim().toLowerCase() && password === env.PREVIEW_ADMIN_PASSWORD;
    if (valid) logger.info({ adminId: previewAdmin.id }, "admin.login.success.preview");
    return valid ? { ...previewAdmin, email: env.PREVIEW_ADMIN_EMAIL! } : null;
  }
  const admin = await prisma.admin.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!admin || !(await argon2.verify(admin.passwordHash, password))) return null;
  await prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  logger.info({ adminId: admin.id }, "admin.login.success");
  return admin;
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
