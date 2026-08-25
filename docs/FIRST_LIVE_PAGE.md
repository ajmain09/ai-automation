# First live Page checklist

Use one real Facebook Page and one controlled Messenger test account. Keep the Page paused until every provider and readiness check passes.

## Three visible onboarding steps

1. **Connect Facebook Page**: connect the Page, verify its Meta Page ID, webhook subscription, and health state.
2. **Business Setup**: enter business truth, products, variants, pricing, policies, order fields, Page AI settings, Page Telegram settings, and Page cost/budget settings.
3. **Review & Go Live**: run Page tests and readiness, publish the draft, then explicitly choose Go Live.

## Verification sequence

1. Log in as the one Super Admin and configure/test Meta Platform.
2. Connect exactly one real Page; confirm identity uses Meta Page ID, not only the display name.
3. Complete Business Setup with the real catalog, policies, delivery rules, and required order fields.
4. Configure that Page's DeepSeek credential, model, behavior, memory, and Test AI.
5. Configure that Page's Telegram credential, Chat ID, notifications, and Test Telegram.
6. Configure that Page's FX rate, pricing snapshots, daily/monthly budget, and hard-limit policy.
7. Run Page Test and resolve every failed readiness check.
8. Publish the draft and choose Go Live.
9. Send a controlled Messenger test and verify inbound storage, Page-scoped context, and the reply.
10. Confirm an order only after explicit confirmation; verify current price, required fields, immutable snapshot, and Telegram outbox delivery.
11. Verify Page AI Usage contains only this Page's calls, tokens, retry attempts, USD/BDT snapshots, and cost.
12. Repeat duplicate-webhook, ambiguous-confirmation, price-change, manual-reply, provider-failure, and budget-limit checks before opening normal traffic.

If any provider is unavailable, keep that Page paused. Inbound receipt and durable storage should continue; no order or notification should disappear silently.
