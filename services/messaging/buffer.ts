const FAST_PATH = new Set(["yes", "no", "confirm", "cancel"]);

export function isFastPathMessage(text: string) {
  return FAST_PATH.has(text.trim().toLocaleLowerCase());
}

export type BufferedTurn = { key: string; messages: string[]; firstAt: number; lastAt: number };

export class SmartMessageBuffer {
  private pending = new Map<string, BufferedTurn>();
  constructor(private readonly debounceMs = 2_000, private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()) {}

  push(key: string, text: string, onFlush: (turn: BufferedTurn) => void, now = Date.now()) {
    const existing = this.pending.get(key);
    const turn = existing ? { ...existing, messages: [...existing.messages, text], lastAt: now } : { key, messages: [text], firstAt: now, lastAt: now };
    this.pending.set(key, turn);
    const previous = this.timers.get(key); if (previous) clearTimeout(previous);
    const delay = isFastPathMessage(text) ? 0 : this.debounceMs;
    const timer = setTimeout(() => { const value = this.pending.get(key); if (value) { this.pending.delete(key); this.timers.delete(key); onFlush(value); } }, delay);
    this.timers.set(key, timer);
  }

  flush(key: string) { const turn = this.pending.get(key); if (!turn) return null; this.pending.delete(key); const timer = this.timers.get(key); if (timer) clearTimeout(timer); this.timers.delete(key); return turn; }
}

export function combineMessages(messages: string[]) { return messages.map((message) => message.trim()).filter(Boolean).join("\n"); }
