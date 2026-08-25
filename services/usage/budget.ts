export type BudgetReservation = { allowed: boolean; reason?: "GLOBAL_LIMIT" | "PAGE_LIMIT"; reservedBdt: number };

/** Pure, atomic-friendly budget decision. Persist the returned reservation in a transaction. */
export function reserveBudget(input: { estimatedBdt: number; globalUsedBdt: number; globalBudgetBdt?: number | null; globalHardLimit: boolean; pageUsedBdt: number; pageBudgetBdt?: number | null; pageHardLimit: boolean }): BudgetReservation {
  const globalBlocked = input.globalHardLimit && !!input.globalBudgetBdt && input.globalUsedBdt + input.estimatedBdt > input.globalBudgetBdt;
  if (globalBlocked) return { allowed: false, reason: "GLOBAL_LIMIT", reservedBdt: 0 };
  const pageBlocked = input.pageHardLimit && !!input.pageBudgetBdt && input.pageUsedBdt + input.estimatedBdt > input.pageBudgetBdt;
  if (pageBlocked) return { allowed: false, reason: "PAGE_LIMIT", reservedBdt: 0 };
  return { allowed: true, reservedBdt: Math.max(0, input.estimatedBdt) };
}
