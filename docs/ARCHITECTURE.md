# Architecture

The application is a Next.js App Router application with TypeScript, Prisma, PostgreSQL, Zod validation, Pino logging, Argon2id password hashing, and HTTP-only signed session cookies. The CSS font stack prefers Geist when installed, then Noto Sans Bengali and system UI fallbacks; the build does not fetch fonts from the network.

The `app/` directory owns routes and route handlers. `components/` contains presentation and client interaction components. `lib/` contains cross-cutting infrastructure (environment validation, database client, auth, logging, encryption, validation). Domain operations live in `services/` and use Prisma transactions where state changes cross multiple tables. `worker/` is a minimal future job execution boundary.

Step 2 adds a Meta service boundary for OAuth, Page discovery, encrypted Page credentials, health/subscription state, and one shared webhook endpoint. The webhook resolves Meta Page ID to internal `page_id`, records idempotent events/messages, filters system/echo traffic, and enqueues short-lived conversation jobs without calling AI inline.

Jobs are PostgreSQL-backed through the `Job` model. Claiming uses leases and a PostgreSQL advisory lock keyed by conversation so one conversation is sequential while independent conversations can run concurrently. Retries use exponential backoff with jitter; expired and dead-letter states are retained. The in-memory queue is only a local unit-test fake.

AI is provider-agnostic at `services/ai/provider.ts`; DeepSeek is the current provider. Every attempt is recorded in `AiRun` and `ApiUsage`, including retries and rate snapshots. Zod contracts, local product retrieval, structured memory updates, version checks, canonical product validation, and outbound state transitions protect the business source of truth.

The global AI kill switch and per-Page switch stop new AI replies while inbound storage continues. No Redis, flow builder, Telegram, or Step 3 order automation is included.

## Configuration lifecycle

Business and catalog writes create or update a DRAFT configuration version. Publishing archives the prior LIVE version and promotes the selected draft. The version model is designed for rollback without requiring a diff UI in Step 1.
