# Build Status — Step 3

Status: COMPLETE for local code, schema, mocked-domain, and production-build validation. External runtime configuration remains deferred.

Implemented:

- Backend-controlled order states with explicit confirmation, required-field validation, page settings, normalized phones, draft updates, repeat-safe `order_session_id`, immutable confirmation snapshots, price-change re-confirmation, revisions, and cancellation events.
- Transactional order confirmation plus deterministic Telegram delivery outbox keys, worker delivery, retry/dead-letter states, permanent/transient classification, and actionable Issues.
- Safe outbound final checks, attachment fallback, expired-job protection, AI attempt records created before provider execution, retry attempts, and page-scoped AI usage.
- Lightweight retry/circuit-breaker primitives, health states, deterministic readiness checks, guarded go-live transition, configuration rollback, recovery-token service, and production backup/restore scripts.
- Issues and Orders operator screens plus health/readiness API boundaries.

Verification:

- Prisma validate: PASS with `DATABASE_URL` set to the documented PostgreSQL URL shape.
- Prisma generate: PASS.
- ESLint: PASS.
- TypeScript: PASS.
- Vitest: PASS — 16 tests.
- Next.js production build: PASS with the documented PostgreSQL URL placeholder; no database was contacted.

DEFERRED TO VPS:

- Live PostgreSQL migration/apply, worker lease/recovery smoke test, backup restore smoke test, Docker build/compose smoke test, Caddy certificate/domain check, and graceful deployment test.
- Meta webhook/send runtime, DeepSeek runtime, and Telegram Bot API runtime.

EXTERNAL CONFIG REQUIRED:

- Production `DATABASE_URL`, `SESSION_SECRET`, explicit admin password/recovery delivery, Meta app credentials and webhook verification, DeepSeek key/rates, Telegram destination, domain/Caddy values, and backup storage credentials.
