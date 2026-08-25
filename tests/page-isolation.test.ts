import { describe, expect, it } from "vitest";

const karseell = "11111111-1111-4111-8111-111111111111";
const saree = "11111111-1111-4111-8111-111111111112";

describe("locked page-scoped AI, Telegram, and cost boundaries", () => {
  it("keeps AI credentials and behavior separate", async () => {
    const { getPreviewAiSettings, updatePreviewAiSettings } = await import("@/services/preview/store");
    const before = getPreviewAiSettings(saree);
    updatePreviewAiSettings(karseell, { modelOverride: "deepseek-v4-pro", customSalesInstructions: "Karseell only" });
    const after = getPreviewAiSettings(saree);
    expect(getPreviewAiSettings(karseell).modelOverride).toBe("deepseek-v4-pro");
    expect(getPreviewAiSettings(karseell).customSalesInstructions).toBe("Karseell only");
    expect(after.accountLabel).toBe("AI account B");
    expect(after.modelOverride).toBe(before.modelOverride);
    expect(after.customSalesInstructions).toBe(before.customSalesInstructions);
  });

  it("keeps Telegram destinations and notification flags separate", async () => {
    const { getPreviewTelegramSettings, updatePreviewTelegramSettings } = await import("@/services/preview/store");
    const before = getPreviewTelegramSettings(saree);
    updatePreviewTelegramSettings(karseell, { chatId: "-100999", newOrderEnabled: false, botToken: "page-a-token" });
    const after = getPreviewTelegramSettings(saree);
    expect(getPreviewTelegramSettings(karseell).chatId).toBe("-100999");
    expect(getPreviewTelegramSettings(karseell).newOrderEnabled).toBe(false);
    expect(after.chatId).toBe(before.chatId);
    expect(after.accountLabel).toBe("Telegram B");
    expect(after.newOrderEnabled).toBe(true);
  });

  it("keeps budgets separate and exposes no global reservation input", async () => {
    const { getPreviewBudgetSummary, updatePreviewPageBudget } = await import("@/services/preview/store");
    updatePreviewPageBudget(karseell, { monthlyBdt: 1234, usdBdtRate: 130 });
    const pageA = getPreviewBudgetSummary(karseell);
    const pageB = getPreviewBudgetSummary(saree);
    expect(pageA.monthlyBdt).toBe(1234);
    expect(pageA.usdBdtRate).toBe(130);
    expect(pageB.monthlyBdt).toBe(300);
    expect(pageB.usdBdtRate).toBe(120);
  });
});
