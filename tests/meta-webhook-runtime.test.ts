import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { InMemoryJobQueue } from "@/services/jobs/queue";

const mocks = vi.hoisted(() => ({
  currentPage: {} as Record<string, unknown>,
  prisma: {
    page: { findUnique: vi.fn() },
    webhookEvent: { create: vi.fn(), update: vi.fn() },
    customer: { upsert: vi.fn() },
    conversation: { upsert: vi.fn(), update: vi.fn() },
    message: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  getMetaPlatformConfig: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/services/meta/settings", () => ({ getMetaPlatformConfig: mocks.getMetaPlatformConfig }));

function connectedPage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-a",
    metaPageId: "META_PAGE_A",
    isActive: true,
    lifecycleStatus: "LIVE",
    aiEnabled: true,
    aiStatus: "RUNNING",
    connectionStatus: "CONNECTED",
    connection: { status: "CONNECTED", encryptedToken: "encrypted-a" },
    aiSettings: { smartBuffer: false, bufferWindowSeconds: 8, manualCollisionProtection: true, manualActivityCooldown: 30 },
    ...overrides,
  };
}

function inbound(mid: string, overrides: Record<string, unknown> = {}) {
  return {
    sender: { id: "CUSTOMER_A" },
    recipient: { id: "META_PAGE_A" },
    timestamp: 1,
    message: { mid, text: "hello" },
    ...overrides,
  };
}

function payload(...events: Array<Record<string, unknown>>) {
  return { object: "page", entry: [{ id: "META_PAGE_A", messaging: events }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentPage = connectedPage();
  mocks.getMetaPlatformConfig.mockResolvedValue({ appId: "APP_A" });
  mocks.prisma.page.findUnique.mockImplementation(async ({ where }: { where: { metaPageId?: string; id?: string } }) => where.metaPageId ? { id: "page-a" } : mocks.currentPage);
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.prisma) => Promise<unknown>) => callback(mocks.prisma));
  mocks.prisma.webhookEvent.create.mockResolvedValue({ id: "event-a" });
  mocks.prisma.webhookEvent.update.mockResolvedValue({ id: "event-a" });
  mocks.prisma.customer.upsert.mockResolvedValue({ id: "customer-a" });
  mocks.prisma.conversation.upsert.mockResolvedValue({ id: "conversation-a", version: 0 });
  mocks.prisma.conversation.update.mockResolvedValue({ id: "conversation-a", version: 1 });
  mocks.prisma.message.create.mockResolvedValue({ id: "message-a" });
});

describe("Meta webhook runtime safety", () => {
  it.each([
    ["inactive Page", { isActive: false }, "runtime_gate_page_inactive"],
    ["non-LIVE Page", { lifecycleStatus: "DRAFT" }, "runtime_gate_page_not_live"],
    ["disabled AI", { aiEnabled: false }, "runtime_gate_ai_disabled"],
    ["non-running AI", { aiStatus: "PAUSED" }, "runtime_gate_ai_not_running"],
    ["disconnected Page status", { connectionStatus: "DISCONNECTED" }, "runtime_gate_page_connection_not_connected"],
    ["disconnected connection row", { connection: { status: "ERROR", encryptedToken: "encrypted-a" } }, "runtime_gate_connection_not_connected"],
    ["missing Meta Page ID", { metaPageId: null }, "runtime_gate_meta_page_id_missing"],
    ["missing Page token", { connection: { status: "CONNECTED", encryptedToken: null } }, "runtime_gate_meta_token_missing"],
  ])("stores but does not enqueue for %s", async (_label, overrides, reason) => {
    mocks.currentPage = connectedPage(overrides);
    const queue = new InMemoryJobQueue();
    const body = payload(inbound(`mid-${reason}`));
    const { ingestMetaWebhook } = await import("@/services/meta/webhook");

    await expect(ingestMetaWebhook(JSON.stringify(body), body, queue, true)).resolves.toEqual({ accepted: true });

    expect(queue.snapshot()).toHaveLength(0);
    expect(mocks.prisma.message.create).toHaveBeenCalledOnce();
    expect(mocks.prisma.webhookEvent.update).toHaveBeenCalledWith({ where: { providerId: `META_PAGE_A:mid-${reason}` }, data: expect.objectContaining({ processedAt: expect.any(Date), ignoredReason: reason }) });
  });

  it("enqueues only a connected, LIVE, running Page", async () => {
    const queue = new InMemoryJobQueue();
    const body = payload(inbound("mid-connected"));
    const { ingestMetaWebhook } = await import("@/services/meta/webhook");

    await ingestMetaWebhook(JSON.stringify(body), body, queue, true);

    expect(queue.snapshot()).toHaveLength(1);
    expect(queue.snapshot()[0]).toMatchObject({ pageId: "page-a", conversationId: "conversation-a", type: "PROCESS_CONVERSATION", payload: { conversationId: "conversation-a", version: 1 } });
  });

  it("uses the echo recipient as the customer and updates manual collision state", async () => {
    const queue = new InMemoryJobQueue();
    const event = inbound("mid-manual", { sender: { id: "META_PAGE_A" }, recipient: { id: "CUSTOMER_A" }, message: { mid: "mid-manual", text: "manual answer", is_echo: true, app_id: "OTHER_APP" } });
    const body = payload(event);
    const { ingestMetaWebhook } = await import("@/services/meta/webhook");

    await ingestMetaWebhook(JSON.stringify(body), body, queue, true);

    expect(mocks.prisma.customer.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageId_facebookPsid: { pageId: "page-a", facebookPsid: "CUSTOMER_A" } } }));
    expect(mocks.prisma.conversation.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pageId_providerId: { pageId: "page-a", providerId: "CUSTOMER_A" } } }));
    expect(mocks.prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ manualReplyUntil: expect.any(Date), lastManualReplyAt: expect.any(Date) }) }));
    expect(mocks.prisma.message.create).not.toHaveBeenCalled();
    expect(queue.snapshot()).toHaveLength(0);
  });

  it("rejects an event whose recipient does not match entry.id", async () => {
    const queue = new InMemoryJobQueue();
    const body = payload(inbound("mid-mismatch", { recipient: { id: "OTHER_PAGE" } }));
    const { ingestMetaWebhook } = await import("@/services/meta/webhook");

    await ingestMetaWebhook(JSON.stringify(body), body, queue, true);

    expect(mocks.prisma.webhookEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ignoredReason: "page_identity_mismatch", processedAt: expect.any(Date) }) });
    expect(mocks.prisma.customer.upsert).not.toHaveBeenCalled();
    expect(queue.snapshot()).toHaveLength(0);
  });

  it("continues after a duplicate event and processes later events in the same batch", async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
    mocks.prisma.webhookEvent.create.mockRejectedValueOnce(duplicate).mockResolvedValueOnce({ id: "event-fresh" });
    const queue = new InMemoryJobQueue();
    const body = payload(inbound("mid-duplicate"), inbound("mid-fresh"));
    const { ingestMetaWebhook } = await import("@/services/meta/webhook");

    await expect(ingestMetaWebhook(JSON.stringify(body), body, queue, true)).resolves.toEqual({ accepted: true, duplicate: true });

    expect(mocks.prisma.webhookEvent.create).toHaveBeenCalledTimes(2);
    expect(queue.snapshot()).toHaveLength(1);
  });

  it("stores only the current event envelope, never the full cross-Page batch", async () => {
    mocks.prisma.page.findUnique.mockImplementation(async ({ where }: { where: { metaPageId?: string; id?: string } }) => where.metaPageId ? { id: where.metaPageId === "META_PAGE_A" ? "page-a" : "page-b" } : { ...connectedPage(), id: where.id, metaPageId: where.id === "page-a" ? "META_PAGE_A" : "META_PAGE_B" });
    const queue = new InMemoryJobQueue();
    const body = { object: "page", entry: [{ id: "META_PAGE_A", messaging: [inbound("mid-a")] }, { id: "META_PAGE_B", messaging: [{ ...inbound("mid-b"), sender: { id: "CUSTOMER_B" }, recipient: { id: "META_PAGE_B" } }] }] };
    const { ingestMetaWebhook } = await import("@/services/meta/webhook");

    await ingestMetaWebhook(JSON.stringify(body), body, queue, true);

    const firstPayload = mocks.prisma.webhookEvent.create.mock.calls[0][0].data.payload;
    expect(firstPayload.entry).toHaveLength(1);
    expect(firstPayload.entry[0].id).toBe("META_PAGE_A");
    expect(JSON.stringify(firstPayload)).not.toContain("META_PAGE_B");
  });

  it("requires object=page", async () => {
    const { ingestMetaWebhook } = await import("@/services/meta/webhook");
    await expect(ingestMetaWebhook("{}", { object: "instagram", entry: [] }, new InMemoryJobQueue(), true)).rejects.toThrow("Invalid Meta webhook payload");
  });
});
