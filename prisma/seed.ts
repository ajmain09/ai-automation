import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD;
  if (!password || (process.env.NODE_ENV === "production" && password === "change-this-before-running-in-production")) throw new Error("ADMIN_PASSWORD must be explicitly configured; default production passwords are forbidden");
  const admin = await prisma.admin.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
  });

  await prisma.auditLog.create({ data: { adminId: admin.id, action: "seed.completed" } });
}

main().finally(() => prisma.$disconnect());
