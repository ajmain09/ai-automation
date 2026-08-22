import { describe, expect, it } from "vitest";
import { SmartMessageBuffer, combineMessages, isFastPathMessage } from "@/services/messaging/buffer";
import { canSendReply } from "@/services/messaging/version";
import { InMemoryJobQueue } from "@/services/jobs/queue";
import { applyFactUpdates, emptyMemory, shouldAsk } from "@/services/memory/service";
import { rankProducts } from "@/services/products/retrieval";
import { buildBoundedContext } from "@/services/ai/context";
import { aiResponseSchema } from "@/lib/validation/ai";
import { assertSamePage } from "@/services/page-scope";

describe("Step 2 conversation safety", () => {
  it("combines rapid messages and fast-path confirmations", async () => {
    const buffer = new SmartMessageBuffer(10);
    const turns: string[][] = [];
    buffer.push("page-a/customer-1", "vai", (turn) => turns.push(turn.messages));
    buffer.push("page-a/customer-1", "price koto", (turn) => turns.push(turn.messages));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(combineMessages(turns[0])).toBe("vai\nprice koto");
    expect(isFastPathMessage(" confirm ")).toBe(true);
  });

  it("blocks stale replies, manual collisions, and expired jobs", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(canSendReply({ generatedVersion: 20, currentVersion: 21 }).ok).toBe(false);
    expect(canSendReply({ generatedVersion: 20, currentVersion: 20, manualReplyUntil: new Date(now.getTime() + 1000), now }).reason).toBe("MANUAL_REPLY_COLLISION");
    expect(canSendReply({ generatedVersion: 20, currentVersion: 20, expiresAt: new Date(now.getTime() - 1), now }).reason).toBe("JOB_EXPIRED");
  });

  it("keeps a conversation sequential while allowing independent conversations", async () => {
    const queue = new InMemoryJobQueue();
    await queue.enqueue({ pageId: "page-a", conversationId: "conversation-1", type: "reply", payload: {}, idempotencyKey: "one" });
    await queue.enqueue({ pageId: "page-a", conversationId: "conversation-1", type: "reply", payload: {}, idempotencyKey: "two" });
    await queue.enqueue({ pageId: "page-a", conversationId: "conversation-2", type: "reply", payload: {}, idempotencyKey: "three" });
    const first = await queue.claim("worker-a");
    expect(first?.conversationId).toBe("conversation-1");
    expect((await queue.claim("worker-b"))?.conversationId).toBe("conversation-2");
    await queue.complete(first!.id);
    expect((await queue.claim("worker-c"))?.conversationId).toBe("conversation-1");
  });

  it("deduplicates jobs and expires old work", async () => {
    const queue = new InMemoryJobQueue();
    const a = await queue.enqueue({ type: "reply", payload: {}, idempotencyKey: "same", ttlMs: 1 });
    const b = await queue.enqueue({ type: "reply", payload: {}, idempotencyKey: "same" });
    expect(a.id).toBe(b.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await queue.expire()).toBe(1);
  });
});

describe("Step 2 data boundaries", () => {
  it("applies customer corrections and semantic anti-repeat keys", () => {
    let memory = emptyMemory();
    memory = applyFactUpdates(memory, [{ key: "chemical_treatment", value: "color", operation: "SET" }]);
    memory = applyFactUpdates(memory, [{ key: "chemical_treatment", value: "bleached", operation: "CORRECT" }]);
    expect(memory.knownFacts.chemical_treatment).toBe("bleached");
    expect(shouldAsk({ ...memory, semanticQuestionsAsked: ["budget"] }, "budget")).toBe(false);
    expect(shouldAsk(memory, "hair_problem")).toBe(true);
  });

  it("retrieves relevant products without crossing page scope", () => {
    const products = rankProducts([{ id: "a", name: "Hair Repair", description: "For frizzy hair", tags: ["dry"] }, { id: "b", name: "Face Wash", description: "Daily cleanser", tags: ["skin"] }], "my hair is dry and frizzy");
    expect(products.map((product) => product.id)).toEqual(["a"]);
    expect(() => assertSamePage("page-a", "page-b")).toThrow("Cross-page access denied");
  });

  it("preserves protected truth when context is bounded", () => {
    const context = buildBoundedContext({ rules: "PROTECTED RULE", policies: "LIVE PRICE 20", products: [], memory: emptyMemory(), orderState: {}, summary: "old", recentMessages: ["old chat".repeat(100)], newestMessage: "newest", maxChars: 100 });
    expect(context).toContain("PROTECTED RULE");
    expect(context).toContain("LIVE PRICE 20");
    expect(context).toContain("newest");
  });

  it("rejects malformed or empty AI replies at the boundary", () => {
    expect(aiResponseSchema.safeParse({ reply: "" }).success).toBe(false);
    expect(aiResponseSchema.safeParse({ intent: "price", reply: "Here", recommended_product_ids: ["not-a-uuid"] }).success).toBe(false);
  });
});
