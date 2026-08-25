import { describe, expect, it } from "vitest";
import { applyFactUpdates, canonicalFactKey, canonicalQuestionKey, emptyMemory, markQuestionAsked, shouldAsk } from "@/services/memory/service";

describe("controlled customer memory", () => {
  it("rejects arbitrary AI keys and normalizes controlled values", () => {
    const memory = applyFactUpdates(emptyMemory(), [
      { key: "not_a_real_fact", value: "do not store", operation: "SET" },
      { key: "hair_problem", value: "  dry   and   frizzy  ", operation: "SET", confidence: 0.95 },
    ]);
    expect(memory.knownFacts).toEqual({ hair_problem: "dry and frizzy" });
    expect(memory.knownFacts.not_a_real_fact).toBeUndefined();
    expect(canonicalFactKey("preferred_type")).toBe("preferred_product_type");
  });

  it("keeps uncertain candidates out of authoritative facts", () => {
    const memory = applyFactUpdates(emptyMemory(), [{ key: "budget", value: "maybe 500ml", confidence: 0.4, operation: "SET" }]);
    expect(memory.knownFacts.budget).toBeUndefined();
    expect(memory.unconfirmedFacts.budget).toBe("maybe 500ml");
  });

  it("maps equivalent English and Bengali questions to one semantic key", () => {
    expect(canonicalQuestionKey("What problem is your hair having?")).toBe("hair_problem");
    expect(canonicalQuestionKey("আপনার চুলের সমস্যাটি কী?")).toBe("hair_problem");
    expect(canonicalQuestionKey("চুলে কী সমস্যা হচ্ছে?")).toBe("hair_problem");
    const memory = markQuestionAsked(emptyMemory(), "আপনার চুলের সমস্যাটি কী?");
    expect(shouldAsk(memory, "hair_problem")).toBe(false);
  });

  it("supports correction without treating an unknown question key as answered", () => {
    let memory = applyFactUpdates(emptyMemory(), [{ key: "hair_problem", value: "oily", operation: "SET", confidence: 0.95 }]);
    memory = applyFactUpdates(memory, [{ key: "hair_problem", value: "scalp oily but hair dry", operation: "CORRECT", confidence: 0.98 }]);
    expect(memory.knownFacts.hair_problem).toBe("scalp oily but hair dry");
    expect(shouldAsk(memory, "not_a_question")).toBe(false);
  });
});
