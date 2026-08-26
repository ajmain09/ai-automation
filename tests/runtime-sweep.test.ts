import { describe, expect, it } from "vitest";
import { providerCircuit } from "@/services/resilience/retry";
import { isClearConfirmation } from "@/services/orders/engine";
import { startOfDhakaDay, startOfDhakaMonth, dhakaDateKey } from "@/services/time/timezone";

describe("runtime sweep regressions", () => {
  it("keeps provider circuit state isolated per Page", () => {
    expect(providerCircuit("deepseek:page-a")).not.toBe(providerCircuit("deepseek:page-b"));
  });

  it("uses Bangladesh calendar boundaries for usage", () => {
    const instant = new Date("2026-08-26T00:30:00.000Z");
    expect(startOfDhakaDay(instant).toISOString()).toBe("2026-08-25T18:00:00.000Z");
    expect(dhakaDateKey(instant)).toBe("2026-08-26");
    expect(startOfDhakaMonth(instant).toISOString()).toBe("2026-07-31T18:00:00.000Z");
  });

  it("does not treat ambiguous confirmation as confirmation", () => {
    expect(isClearConfirmation("ji kore den")).toBe(true);
    expect(isClearConfirmation("hmm")).toBe(false);
    expect(isClearConfirmation("maybe")).toBe(false);
  });
});
