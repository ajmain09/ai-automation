import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "change-this-before-running-in-production";
  const admin = await prisma.admin.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
  });

  const page = await prisma.page.upsert({
    where: { slug: "demo-page" },
    update: {},
    create: { name: "Your first Facebook Page", slug: "demo-page", aiEnabled: false },
  });
  await prisma.pageSettings.upsert({
    where: { pageId: page.id },
    update: {},
    create: { pageId: page.id, requiredOrderFields: ["name", "phone", "address", "product", "variant", "quantity"] },
  });
  await prisma.configurationVersion.upsert({
    where: { pageId_version: { pageId: page.id, version: 1 } },
    update: {},
    create: { pageId: page.id, version: 1, status: "DRAFT", label: "Initial draft" },
  });
  await prisma.auditLog.create({ data: { adminId: admin.id, pageId: page.id, action: "seed.completed" } });
}

main().finally(() => prisma.$disconnect());
