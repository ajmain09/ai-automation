# Database Foundation

Prisma models cover admins, recovery tokens, pages, connections, settings, configuration versions, business profiles, knowledge items, products and variants, customers and memory, conversations and messages, webhook events, order sessions, orders and revisions, jobs, outbound delivery, Telegram delivery outbox, AI runs and usage, issues, audit logs, and system settings.

Identity and idempotency constraints include:

- `pages.meta_page_id` unique when present
- `customers(page_id, facebook_psid)` unique
- `messages(page_id, provider_id)` unique
- `api_usage.ai_attempt_id` unique
- `delivery_outbox.delivery_key` unique
- `outbound_messages.outbound_attempt_key` unique

All page-owned business queries include `pageId`. Order confirmation snapshots store page, product/variant display truth, price, quantity, currency, customer identity, normalized/original phone, address, configuration version, and confirmation time. Revisions store event type and changed fields; historical data is not mutated by later catalog changes.

`ConfigurationVersion.businessData` contains parsed/manual draft data. Publishing is the only operation that materializes it into the live `BusinessProfile` and catalog. Critical parsed conflicts block publishing, and readiness is required before a Page can go LIVE.

`ApiUsage` stores provider, model, call type, token totals, provider usage, request ID, attempt number, rate snapshots, estimated cost, status, and latency. It is the sole analytics dataset and is always scoped by `pageId`. Attempts are created before provider execution, so failed attempts remain visible.

PostgreSQL is the only required stateful service; Redis is intentionally not used. The checked-in Step 3 migration is additive and includes a deterministic UUID backfill for existing orders. Live migration application and restore smoke testing are deferred to the VPS because local PostgreSQL is unavailable.
