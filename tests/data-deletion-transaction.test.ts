import { describe, expect, it, vi } from "vitest";

const { transaction, orderUpdate } = vi.hoisted(() => {
  const orderUpdate = vi.fn(async () => { throw new Error("simulated order write failure"); });
  const tx = {
    customer: { findFirst: vi.fn(async () => ({ id: "44444444-4444-4444-8444-444444444441" })), delete: vi.fn() },
    order: { findMany: vi.fn(async () => [{ id: "order-1", payload: { customer_name: "private" } }]), update: orderUpdate },
    orderRevision: { findMany: vi.fn(), update: vi.fn() },
    orderSession: { updateMany: vi.fn() },
    conversation: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    dataDeletionRequest: { upsert: vi.fn(async () => ({ id: "request-1", requestKey: "rollback-001", pageId: "11111111-1111-4111-8111-111111111111", customerId: "44444444-4444-4444-8444-444444444441", status: "PROCESSING", ordersPreserved: 0 })), update: vi.fn() },
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  return { transaction, orderUpdate };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: transaction } }));

describe("data deletion transaction boundary", () => {
  it("propagates a failed scoped write so the database transaction can roll back", async () => {
    const { executeCustomerDataDeletion } = await import("@/services/data-deletion/service");
    await expect(executeCustomerDataDeletion({ pageId: "11111111-1111-4111-8111-111111111111", customerId: "44444444-4444-4444-8444-444444444441", requestKey: "rollback-001" })).rejects.toThrow("simulated order write failure");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(orderUpdate).toHaveBeenCalledTimes(1);
  });
});
