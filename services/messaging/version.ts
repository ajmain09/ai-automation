export function canSendReply(input: { generatedVersion: number; currentVersion: number; now?: Date; manualReplyUntil?: Date | null; expiresAt?: Date | null }) {
  const now = input.now ?? new Date();
  if (input.generatedVersion !== input.currentVersion) return { ok: false, reason: "STALE_CONVERSATION_VERSION" as const };
  if (input.manualReplyUntil && input.manualReplyUntil > now) return { ok: false, reason: "MANUAL_REPLY_COLLISION" as const };
  if (input.expiresAt && input.expiresAt <= now) return { ok: false, reason: "JOB_EXPIRED" as const };
  return { ok: true as const };
}
