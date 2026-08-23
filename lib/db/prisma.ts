import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Keep client construction lazy. This matters for the fixture-only local preview:
// importing a production service must not require DATABASE_URL or contact Postgres.
function getPrismaClient() {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = new PrismaClient({ log: ["error"] });
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient() as unknown as Record<PropertyKey, unknown>;
    const value = client[property];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
