import { describe, expect, it } from "vitest";
import { workerHealthState } from "@/services/health/service";
import { budgetState } from "@/services/usage/cost";
import { evaluateMemoryReadiness } from "@/services/pages/readiness";
import { evaluateProductTruth } from "@/services/products/retrieval";

describe("final pre-deploy blocker regressions", () => {
  it("classifies worker heartbeat age", () => {
    expect(workerHealthState(30)).toBe("HEALTHY");
    expect(workerHealthState(120)).toBe("STALE");
    expect(workerHealthState(301)).toBe("DOWN");
  });

  it("derives real budget states", () => {
    expect(budgetState({ usedBdt: 0, budgetBdt: null, warningThreshold: 85 })).toBe("NO_BUDGET");
    expect(budgetState({ usedBdt: 10, budgetBdt: 100, warningThreshold: 85 })).toBe("OK");
    expect(budgetState({ usedBdt: 90, budgetBdt: 100, warningThreshold: 85 })).toBe("WARNING");
    expect(budgetState({ usedBdt: 100, budgetBdt: 100, warningThreshold: 85 })).toBe("LIMIT_REACHED");
    expect(budgetState({ usedBdt: 0, budgetBdt: 100, warningThreshold: 85, paused: true })).toBe("PAUSED");
  });

  it("fails readiness for broken memory and invalid product truth", () => {
    expect(evaluateMemoryReadiness(true, false).ok).toBe(false);
    expect(evaluateProductTruth([{ variants: [{ currentPrice: 0, stockStatus: "IN_STOCK" }] }]).ok).toBe(false);
    expect(evaluateProductTruth([{ variants: [{ currentPrice: 25, stockStatus: "PREORDER" }] }]).ok).toBe(true);
  });
});
