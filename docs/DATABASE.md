# Database Foundation

Prisma models cover admins, pages, connections, settings, configuration versions, business profiles, knowledge items, products and variants, customers and memory, conversations and messages, webhook events, order sessions, orders and revisions, jobs, outbound delivery, AI runs and usage, issues, audit logs, and system settings.

Identity and idempotency constraints include:

- `pages.meta_page_id` unique when present
- `customers(page_id, facebook_psid)` unique
- `messages(page_id, provider_id)` unique
- `api_usage.ai_attempt_id` unique
- `delivery_outbox.delivery_key` unique
- `outbound_messages.outbound_attempt_key` unique

Internal identifiers are UUIDs. All business-facing relations include `pageId` where the data is page-owned. PostgreSQL is the only required stateful service; Redis is intentionally not used.
