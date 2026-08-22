import { RetrievedProduct } from "@/services/products/retrieval";
import { CustomerMemory } from "@/services/memory/service";

export type ContextInput = { rules: string; policies: string; products: RetrievedProduct[]; memory: CustomerMemory; orderState: unknown; summary: string; recentMessages: string[]; newestMessage: string; maxChars?: number };
export function buildBoundedContext(input: ContextInput) {
  const max = input.maxChars ?? 18_000;
  const protectedText = [`RULES\n${input.rules}`, `LIVE POLICIES\n${input.policies}`, `RELEVANT PRODUCTS\n${JSON.stringify(input.products)}`, `CUSTOMER MEMORY\n${JSON.stringify(input.memory)}`, `ORDER STATE\n${JSON.stringify(input.orderState)}`].join("\n\n");
  let history = [`SUMMARY\n${input.summary}`, `RECENT MESSAGES\n${input.recentMessages.join("\n")}`].join("\n\n");
  const newest = `NEWEST CUSTOMER MESSAGE\n${input.newestMessage}`;
  const remaining = Math.max(0, max - protectedText.length - newest.length - 100);
  if (history.length > remaining) history = history.slice(Math.max(0, history.length - remaining));
  return `${protectedText}\n\n${history}\n\n${newest}`;
}
