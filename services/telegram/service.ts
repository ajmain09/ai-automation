import { prisma } from "@/lib/db/prisma";
import { decryptCredential, encryptCredential } from "@/lib/encryption/service";
import { classifyFailure, withProviderCircuit } from "@/services/resilience/retry";

export type TelegramDestination = { botToken: string; chatId: string };
export type TelegramNotificationSettings = { newOrderEnabled: boolean; updatedOrderEnabled: boolean; cancelledOrderEnabled: boolean };
export type TelegramClient = { sendMessage(destination: TelegramDestination, text: string): Promise<{ messageId?: string }> };

export class TelegramBotApi implements TelegramClient {
  constructor(private readonly pageScope?: string) {}
  async sendMessage(destination: TelegramDestination, text: string) {
    return withProviderCircuit(this.pageScope ? `telegram:${this.pageScope}` : "telegram", async () => {
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
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true, telegramSettings: true } });
  if (!page) throw new Error("Page not found");
  const settings = page.telegramSettings;
  if (!settings?.encryptedBotToken || !settings.chatId || settings.status !== "CONNECTED") return null;
  return { botToken: decryptCredential(settings.encryptedBotToken), chatId: settings.chatId };
}

export async function getPageTelegramSettings(pageId: string) {
  const settings = await prisma.pageTelegramSettings.findUnique({ where: { pageId }, select: { pageId: true, chatId: true, newOrderEnabled: true, updatedOrderEnabled: true, cancelledOrderEnabled: true, status: true, lastError: true, lastTestAt: true, encryptedBotToken: true } });
  if (!settings) return null;
  return { ...settings, encryptedBotToken: undefined, tokenConfigured: Boolean(settings.encryptedBotToken) };
}

export async function setPageTelegramDestination(input: { pageId: string; botToken?: string; chatId: string; newOrderEnabled: boolean; updatedOrderEnabled: boolean; cancelledOrderEnabled: boolean }, adminId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.pageTelegramSettings.findUnique({ where: { pageId: input.pageId }, select: { encryptedBotToken: true } });
    const encryptedBotToken = input.botToken?.trim() ? encryptCredential(input.botToken) : existing?.encryptedBotToken ?? null;
    const status = encryptedBotToken && input.chatId.trim() ? "CONNECTED" : "NOT_CONFIGURED";
    const settings = await tx.pageTelegramSettings.upsert({ where: { pageId: input.pageId }, update: { encryptedBotToken, chatId: input.chatId.trim(), newOrderEnabled: input.newOrderEnabled, updatedOrderEnabled: input.updatedOrderEnabled, cancelledOrderEnabled: input.cancelledOrderEnabled, status, lastError: null }, create: { pageId: input.pageId, encryptedBotToken, chatId: input.chatId.trim(), newOrderEnabled: input.newOrderEnabled, updatedOrderEnabled: input.updatedOrderEnabled, cancelledOrderEnabled: input.cancelledOrderEnabled, status } });
    await tx.auditLog.create({ data: { adminId, pageId: input.pageId, action: "telegram.configuration_changed" } });
    return settings;
  });
  return result;
}

export async function testPageTelegramDestination(input: { pageId: string; botToken: string; chatId: string; newOrderEnabled: boolean; updatedOrderEnabled: boolean; cancelledOrderEnabled: boolean }, adminId: string) {
  try {
    const result = await new TelegramBotApi(input.pageId).sendMessage({ botToken: input.botToken, chatId: input.chatId }, "Growthifyx AI Sales Telegram test");
    await prisma.$transaction(async (tx) => {
      await tx.pageTelegramSettings.upsert({ where: { pageId: input.pageId }, update: { encryptedBotToken: encryptCredential(input.botToken), chatId: input.chatId, newOrderEnabled: input.newOrderEnabled, updatedOrderEnabled: input.updatedOrderEnabled, cancelledOrderEnabled: input.cancelledOrderEnabled, status: "CONNECTED", lastTestAt: new Date(), lastError: null }, create: { pageId: input.pageId, encryptedBotToken: encryptCredential(input.botToken), chatId: input.chatId, newOrderEnabled: input.newOrderEnabled, updatedOrderEnabled: input.updatedOrderEnabled, cancelledOrderEnabled: input.cancelledOrderEnabled, status: "CONNECTED", lastTestAt: new Date() } });
      await tx.auditLog.create({ data: { adminId, pageId: input.pageId, action: "telegram.connection_tested", metadata: { providerMessageId: result.messageId ?? null } } });
    });
    return { ok: true, messageId: result.messageId };
  } catch {
    await prisma.pageTelegramSettings.updateMany({ where: { pageId: input.pageId }, data: { status: "ERROR", lastTestAt: new Date(), lastError: "Telegram rejected the test message." } });
    return { ok: false, error: "Telegram rejected the test message. Check the Page bot token and chat ID." };
  }
}

export function classifyTelegramFailure(error: unknown) { return classifyFailure(error); }
