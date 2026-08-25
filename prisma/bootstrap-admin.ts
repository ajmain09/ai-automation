import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import argon2 from "argon2";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function readSecret(prompt: string) {
  if (!input.isTTY || !output.isTTY) {
    const value = process.env.ADMIN_PASSWORD?.trim();
    if (!value) throw new Error("ADMIN_PASSWORD is required when bootstrap has no interactive TTY; it is never printed.");
    return value;
  }

  output.write(prompt);
  input.setRawMode?.(true);
  input.resume();
  let value = "";
  return new Promise<string>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      const character = chunk.toString("utf8");
      if (character === "\u0003") {
        cleanup();
        reject(new Error("Bootstrap cancelled."));
      } else if (character === "\r" || character === "\n") {
        cleanup();
        output.write("\n");
        resolve(value);
      } else if (character === "\u0008" || character === "\u007f") {
        value = value.slice(0, -1);
      } else if (character.length === 1 || character.length > 1) {
        value += character;
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
    };
    input.on("data", onData);
  });
}

async function main() {
  const rl = createInterface({ input, output });
  try {
    const configuredEmail = process.env.ADMIN_EMAIL?.trim();
    const email = (configuredEmail || await rl.question("Super Admin email: ")).trim().toLowerCase();
    if (!validEmail(email)) throw new Error("ADMIN_EMAIL must be a valid email address.");
    const existing = await prisma.admin.count();
    if (existing > 0) {
      console.log("A Super Admin already exists; no changes were made.");
      return;
    }
    const password = await readSecret("Super Admin password: ");
    if (password.length < 12) throw new Error("The Super Admin password must be at least 12 characters.");
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(748319041)`;
      if (await tx.admin.count() > 0) return false;
      const admin = await tx.admin.create({ data: { email, passwordHash } });
      await tx.auditLog.create({ data: { adminId: admin.id, action: "admin.bootstrap.created" } });
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    console.log(created ? "Super Admin created. The password was not printed or stored in plaintext." : "A Super Admin already exists; no changes were made.");
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Super Admin bootstrap failed.");
  process.exitCode = 1;
});
