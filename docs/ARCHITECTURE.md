# Architecture

The application is a Next.js App Router application with TypeScript, Prisma, PostgreSQL, Zod validation, Pino logging, Argon2id password hashing, and HTTP-only signed session cookies. The production URL is `https://ai.growthifyx.space`; the required public callback and policy routes are `/api/meta/oauth/callback`, `/api/meta/webhook`, `/privacy`, and `/data-deletion`. The CSS font stack prefers Geist when installed, then Noto Sans Bengali and system UI fallbacks; the build does not fetch fonts from the network.

The `app/` directory owns routes and route handlers. `components/` contains presentation and client interaction components. `lib/` contains cross-cutting infrastructure (environment validation, database client, auth, logging, encryption, validation). Domain operations live in `services/` and use Prisma transactions where state changes cross multiple tables. `worker/` is the job execution boundary.

Step 2 provides Meta OAuth/Page discovery, encrypted Page credentials, health/subscription state, a shared signed webhook endpoint, idempotent events/messages, PostgreSQL jobs with leases/retries/jitter/TTL/dead-letter state, smart buffering, version/manual collision protection, outbound delivery states, strict Zod contracts, business parsing, page-scoped memory/retrieval, canonical product validation, draft-only configuration parsing, and the Page AI Usage view. DeepSeek credentials, provider balance, model behavior, Telegram credentials, notification switches, FX, pricing, budgets, reservations, and usage are all owned by `page_id`.

Step 3 extends the same boundaries with backend-owned order state transitions, page-scoped drafts and immutable confirmation snapshots, revision events, a transactional Telegram delivery outbox, retry/dead-letter handling, actionable Issues, health checks, configuration rollback, and deterministic go-live readiness. Telegram credentials remain behind the encryption boundary. No Redis, flow builder, or external automation platform is used.

Global Settings contains only General, Meta Platform, Security, and System Health. Meta is the only master integration. There is no global AI key, global Telegram bot, global AI budget, global pricing profile, or global AI pause. A Page switch stops only that Page's AI replies while inbound webhook receipt and message storage continue. AI intent is only a candidate signal: it never confirms, creates, updates, or cancels an order directly.

## Configuration lifecycle

Business and catalog writes create or update a DRAFT configuration version. Publishing archives the prior LIVE version and promotes the selected draft. Readiness checks and go-live are separate from publishing. Rollback promotes an existing validated version without requiring a diff UI.

## Step 3 runtime boundaries

An order confirmation transaction writes the order snapshot, revision 0, and a deterministic delivery outbox key; the worker then performs Telegram delivery independently. Telegram failure cannot roll back a confirmed order. Automatic replies re-check the Page AI state, Page credential, connection, conversation version, TTL, manual collision, live configuration, and current product truth immediately before sending. A conditional database reservation checks Page usage plus in-flight reservations atomically. If a hard Page budget is reached, only that Page becomes `PAUSED_BY_BUDGET`, an actionable Issue is created, and inbound messages continue to be stored. Expired work cannot confirm an order or create a notification.
