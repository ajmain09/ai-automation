import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logging/logger";

const COOKIE = "gx_session";
const SESSION_TTL = 60 * 60 * 8;

function sign(value: string) { return createHmac("sha256", getEnv().SESSION_SECRET).update(value).digest("base64url"); }

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
  if (!signature || sign(token) !== signature) return null;
  const issuedAt = Number(parts[2]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL * 1000) return null;
  return prisma.admin.findUnique({ where: { id: parts[0] } });
}

export async function requireAdmin() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");
  return admin;
}

export async function authenticateAdmin(email: string, password: string) {
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
