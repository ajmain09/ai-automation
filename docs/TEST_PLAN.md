# Step 3 Test Plan

Run from the project root:

```bash
npm install
npx prisma validate
npx prisma generate
npm run lint
npm run typecheck
npm test
npm run build
```

For local development, set `DATABASE_URL` to the PostgreSQL URL shape in `.env.example`. No live PostgreSQL or Docker is required for unit and mocked domain tests.

Coverage includes page isolation, duplicate webhook/idempotency and ordering, debounce, stale/manual/expired reply protection, memory correction and anti-repeat, product ranking and validation, malformed/empty AI output, usage attempts and retries, global/Page AI pause, phone normalization, explicit/ambiguous order confirmation, required fields, price-change rejection, immutable snapshots, repeat purchase sessions, revisions, cancellation, Telegram message hygiene, retry classification, jittered backoff, circuit recovery, draft/live separation, rollback, and readiness blocking.

The final audit also checks production-domain configuration, strict environment validation, same-origin protection on admin mutations, deterministic webhook fallback IDs, race-safe Telegram claims, public policy routes, responsive monochrome UI, and absence of seeded demo Pages.

Runtime-only Meta, DeepSeek, Telegram, PostgreSQL, Docker, backup restore, and Caddy checks are explicitly external or deferred to VPS validation.
