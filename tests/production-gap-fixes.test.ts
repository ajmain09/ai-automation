import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekProvider, fallbackAiResponse } from "@/services/ai/provider";

describe("production gap fixes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("wires the configured max output tokens into DeepSeek requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "test", choices: [{ message: { content: "{}" } }], usage: {} }), { status: 200 }));
    const provider = new DeepSeekProvider("candidate-key", "https://example.test", "deepseek-v4-flash", "page-a", { maxOutputTokens: 1234 });
    await provider.complete({ system: "system", user: "user", callType: "PRELIVE_TEST" });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({ max_tokens: 1234, model: "deepseek-v4-flash" });
  });

  it("keeps fallback replies aligned with the configured Page language", () => {
    expect(fallbackAiResponse("bangla").reply).toContain("আপনার");
    expect(fallbackAiResponse("banglish").reply).toContain("Apnar");
    expect(fallbackAiResponse("english").reply).toContain("Thanks");
  });
});
