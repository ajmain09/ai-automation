import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { backoffWithJitter, classifyFailure } from "@/services/resilience/retry";
import { formatOrderEvent, getTelegramDestination, TelegramBotApi, TelegramClient } from "@/services/telegram/service";

export async function processNextTelegramDelivery(client: TelegramClient = new TelegramBotApi()) {
  const now = new Date();
  await prisma.deliveryOutbox.updateMany({ where: { status: "SENDING", leaseUntil: { lt: now } }, data: { status: "DEAD_LETTER", leaseUntil: null, lastError: "Delivery lease expired; manual review required before retry." } });
  const candidate = await prisma.deliveryOutbox.findFirst({ where: { status: { in: ["PENDING", "FAILED_RETRYABLE"] }, nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, orderBy: { nextAttemptAt: "asc" } });
  if (!candidate) return null;
  const claimed = await prisma.deliveryOutbox.updateMany({ where: { id: candidate.id, status: { in: ["PENDING", "FAILED_RETRYABLE"] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { status: "SENDING", attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + 60_000) } });
  if (claimed.count !== 1) return null;
  const current = await prisma.deliveryOutbox.findUnique({ where: { id: candidate.id } });
  if (!current) return null;
  try {
    const destination = await getTelegramDestination(current.pageId);
    if (!destination) throw new Error("Telegram destination is not configured");
    const payload = current.payload as Record<string, unknown>;
    const result = await client.sendMessage(destination, formatOrderEvent(current.eventType, payload));
    return prisma.$transaction(async (tx) => {
      await tx.deliveryAttempt.create({ data: { deliveryOutboxId: current.id, success: true, response: result as Prisma.InputJsonValue } });
      return tx.deliveryOutbox.update({ where: { id: current.id }, data: { status: "SENT", sentAt: new Date(), leaseUntil: null, lastError: null } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram delivery failed";
    const kind = classifyFailure(error);
    const terminal = kind === "PERMANENT" || current.attempts >= current.maxAttempts;
    await prisma.deliveryAttempt.create({ data: { deliveryOutboxId: current.id, success: false, response: { error: message } } });
    if (terminal) {
      await prisma.$transaction([prisma.deliveryOutbox.update({ where: { id: current.id }, data: { status: current.attempts >= current.maxAttempts && kind === "TRANSIENT" ? "DEAD_LETTER" : "FAILED_PERMANENT", leaseUntil: null, lastError: message.slice(0, 500) } }), prisma.issue.create({ data: { pageId: current.pageId, type: "TELEGRAM_DELIVERY", severity: "high", title: "Telegram delivery failed", description: message.slice(0, 500) } })]);
    } else {
      await prisma.deliveryOutbox.update({ where: { id: current.id }, data: { status: "FAILED_RETRYABLE", nextAttemptAt: new Date(Date.now() + backoffWithJitter(current.attempts)), leaseUntil: null, lastError: message.slice(0, 500) } });
    }
    return null;
  }
}
