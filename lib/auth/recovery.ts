import crypto from "node:crypto";
import argon2 from "argon2";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";

export async function createRecoveryToken(adminId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.adminRecoveryToken.create({ data: { adminId, tokenHash, expiresAt: new Date(Date.now() + 15 * 60_000) } });
  return token;
}

export async function resetAdminPassword(token: string, newPassword: string) {
  if (getEnv().NODE_ENV === "production" && newPassword === "change-this-before-running-in-production") throw new Error("A real production password is required");
  if (newPassword.length < 12) throw new Error("Password must be at least 12 characters");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return prisma.$transaction(async (tx) => {
    const recovery = await tx.adminRecoveryToken.findUnique({ where: { tokenHash } });
    if (!recovery || recovery.usedAt || recovery.expiresAt <= new Date()) throw new Error("Recovery token is invalid or expired");
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await tx.admin.update({ where: { id: recovery.adminId }, data: { passwordHash } });
    await tx.adminSession.updateMany({ where: { adminId: recovery.adminId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.adminRecoveryToken.update({ where: { id: recovery.id }, data: { usedAt: new Date() } });
    await tx.auditLog.create({ data: { adminId: recovery.adminId, action: "admin.password_reset" } });
    return true;
  });
}
