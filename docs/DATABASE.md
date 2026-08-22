# Database Foundation

Prisma models cover admins, pages, connections, settings, configuration versions, business profiles, knowledge items, products and variants, customers and memory, conversations and messages, webhook events, order sessions, orders and revisions, jobs, outbound delivery, AI runs and usage, issues, audit logs, and system settings.

Identity and idempotency constraints include:

- `pages.meta_page_id` unique when present
- `customers(page_id, facebook_psid)` unique
- `messages(page_id, provider_id)` unique
- `api_usage.ai_attempt_id` unique
- `delivery_outbox.delivery_key` unique
- `outbound_messages.outbound_attempt_key` unique

Internal identifiers are UUIDs. All business-facing relations include `pageId` where the data is page-owned. `OAuthState` stores only a short-lived hash and encrypted temporary user token. `Conversation.version` protects against stale replies; `Job` stores lease, retry, TTL, idempotency, and dead-letter state. `OutboundMessage` records delivery uncertainty instead of blindly retrying timeouts.

`ConfigurationVersion.businessData` contains parsed/manual draft data. Publishing is the only operation that materializes it into the live `BusinessProfile` and catalog. Critical parsed conflicts block publishing.

`ApiUsage` stores provider, model, call type, token totals, provider usage, request ID, attempt number, rate snapshots, cost, status, and latency. It is the sole analytics data set and is always scoped by `pageId`.

PostgreSQL is the only required stateful service; Redis is intentionally not used. Live migration application is deferred to the VPS because local PostgreSQL is unavailable.
