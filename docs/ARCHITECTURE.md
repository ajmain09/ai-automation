# Architecture

The application is a Next.js App Router application with TypeScript, Prisma, PostgreSQL, Zod validation, Pino logging, Argon2id password hashing, and HTTP-only signed session cookies. The CSS font stack prefers Geist when installed, then Noto Sans Bengali and system UI fallbacks; the build does not fetch fonts from the network.

The `app/` directory owns routes and route handlers. `components/` contains presentation and client interaction components. `lib/` contains cross-cutting infrastructure (environment validation, database client, auth, logging, encryption, validation). Domain operations live in `services/` and use Prisma transactions where state changes cross multiple tables. `worker/` is a minimal future job execution boundary.

The Meta integration is intentionally not implemented. A page has a `PageConnection` boundary, a future credential encryption service, and explicit disconnected/pending UI states. The global AI kill switch is separate from inbound message storage so a future pause can stop processing without losing events.

## Configuration lifecycle

Business and catalog writes create or update a DRAFT configuration version. Publishing archives the prior LIVE version and promotes the selected draft. The version model is designed for rollback without requiring a diff UI in Step 1.
