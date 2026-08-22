import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptCredential, encryptCredential } from "@/lib/encryption/service";
import { classifyFailure, withProviderCircuit } from "@/services/resilience/retry";

export type TelegramDestination = { botToken: string; chatId: string };
export type TelegramClient = { sendMessage(destination: TelegramDestination, text: string): Promise<{ messageId?: string }> };

export class TelegramBotApi implements TelegramClient {
  async sendMessage(destination: TelegramDestination, text: string) {
    return withProviderCircuit("telegram", async () => {
      const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(destination.botToken)}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: destination.chatId, text }), signal: AbortSignal.timeout(10_000) });
      const body = await response.json() as { ok?: boolean; result?: { message_id?: number }; description?: string };
      if (!response.ok || !body.ok) throw new Error(body.description ?? `Telegram request failed (${response.status})`);
      return { messageId: body.result?.message_id?.toString() };
    });
  }
}

export function formatOrderEvent(eventType: string, payload: Record<string, unknown>) {
  const label = eventType.replace("_ORDER", " ORDER");
  const value = (key: string) => String(payload[key] ?? "Not provided");
  return [label, "", `Page: ${value("page_name")}`, `Name: ${value("customer_name")}`, `Phone: ${value("normalized_phone")}`, `Address: ${value("full_address")}`, `Product: ${value("product_display_name")}`, `Variant: ${formatVariant(payload.variant_details)}`, `Quantity: ${value("quantity")}`, `Total: ${value("unit_price")} × ${value("quantity")} ${value("currency")}`].join("\n");
}

function formatVariant(value: unknown) {
  if (!value || typeof value !== "object") return "Not provided";
  const details = value as { sku?: unknown; size?: unknown; color?: unknown };
  return [details.sku, details.size, details.color].filter((item) => typeof item === "string" && item.length > 0).join(" / ") || "Not provided";
}

export async function getTelegramDestination(pageId: string): Promise<TelegramDestination | null> {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true, settings: true } });
  if (!page) throw new Error("Page not found");
  if (page.settings?.telegramEnabled && page.settings.encryptedTelegramBotToken && page.settings.telegramChatId) return { botToken: decryptCredential(page.settings.encryptedTelegramBotToken), chatId: page.settings.telegramChatId };
  const global = await prisma.systemSetting.findUnique({ where: { key: "telegram_global_destination" } });
  if (!global || typeof global.value !== "object" || global.value === null) return null;
  const value = global.value as { encryptedBotToken?: unknown; chatId?: unknown };
  if (typeof value.encryptedBotToken !== "string" || typeof value.chatId !== "string") return null;
  return { botToken: decryptCredential(value.encryptedBotToken), chatId: value.chatId };
}

export async function setPageTelegramDestination(input: { pageId: string; botToken: string; chatId: string; enabled: boolean }, adminId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const settings = await tx.pageSettings.upsert({ where: { pageId: input.pageId }, update: { encryptedTelegramBotToken: encryptCredential(input.botToken), telegramChatId: input.chatId, telegramEnabled: input.enabled }, create: { pageId: input.pageId, requiredOrderFields: ["name", "phone", "address", "product", "variant", "quantity"], encryptedTelegramBotToken: encryptCredential(input.botToken), telegramChatId: input.chatId, telegramEnabled: input.enabled } });
    await tx.auditLog.create({ data: { adminId, pageId: input.pageId, action: "telegram.configuration_changed" } });
    return settings;
  });
  return result;
}

export async function setGlobalTelegramDestination(input: { botToken: string; chatId: string }, adminId: string) {
  return prisma.$transaction(async (tx) => {
    const setting = await tx.systemSetting.upsert({ where: { key: "telegram_global_destination" }, update: { value: telegramConfigJson({ botToken: input.botToken, chatId: input.chatId }) }, create: { key: "telegram_global_destination", value: telegramConfigJson({ botToken: input.botToken, chatId: input.chatId }) } });
    await tx.auditLog.create({ data: { adminId, action: "telegram.global_configuration_changed" } });
    return setting;
  });
}

export function classifyTelegramFailure(error: unknown) { return classifyFailure(error); }

export function telegramConfigJson(input: TelegramDestination) {
  return { encryptedBotToken: encryptCredential(input.botToken), chatId: input.chatId } as Prisma.InputJsonValue;
}
