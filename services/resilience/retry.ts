export type FailureKind = "TRANSIENT" | "PERMANENT";

export function classifyFailure(error: unknown): FailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|abort|429|rate limit|temporar|\b5\d\d\b|network|econn|fetch failed/i.test(message)) return "TRANSIENT";
  return "PERMANENT";
}

export function backoffWithJitter(attempt: number, random = Math.random, baseMs = 1_000, capMs = 15 * 60_000) {
  const exponential = Math.min(capMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.round(exponential * (0.75 + random() * 0.5));
}

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private openedAt = 0;
  constructor(private readonly threshold = 5, private readonly cooldownMs = 30_000) {}
  get status() { return this.state; }
  canCall(now = Date.now()) {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN" && now - this.openedAt >= this.cooldownMs) { this.state = "HALF_OPEN"; return true; }
    return this.state === "HALF_OPEN";
  }
  success() { this.failures = 0; this.state = "CLOSED"; }
  failure(now = Date.now()) { this.failures += 1; if (this.failures >= this.threshold) { this.state = "OPEN"; this.openedAt = now; } }
}

const providerBreakers = new Map<string, CircuitBreaker>();
export function providerCircuit(name: string) {
  const existing = providerBreakers.get(name);
  if (existing) return existing;
  const created = new CircuitBreaker();
  providerBreakers.set(name, created);
  return created;
}

export async function withProviderCircuit<T>(name: string, operation: () => Promise<T>) {
  const breaker = providerCircuit(name);
  if (!breaker.canCall()) throw new Error(`${name} circuit is cooling down`);
  try { const result = await operation(); breaker.success(); return result; } catch (error) { if (classifyFailure(error) === "TRANSIENT") breaker.failure(); throw error; }
}
