# Growthifyx AI Sales — Engineering Rules

1. This is **not SaaS**.
2. There is one Super Admin only.
3. This is a multi-page Facebook Messenger system managed by that admin.
4. `page_id` isolation is mandatory for every relevant business query.
5. AI is never the business source of truth.
6. AI API usage per Page is the only analytics feature.
7. Page onboarding has exactly three visible steps: Connect Facebook Page, Business Setup, Review & Go Live.
8. Do not add Redis unless the architecture is explicitly changed later.
9. Do not add unnecessary features.
10. Do not change architecture without explicit instruction.
11. Tests must pass before a phase is considered complete.

## Development guardrails

- Do not implement Meta, DeepSeek, or Telegram integrations in Step 1.
- Keep credentials behind the encryption service boundary.
- Use Prisma transactions for configuration changes and audit important admin actions.
- Draft configuration changes must not mutate live configuration.
- Never use a Facebook Page name as external identity; use Meta Page ID when available.
