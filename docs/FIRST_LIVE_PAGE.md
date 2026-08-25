# First live Page runbook

Use one real Facebook Page and one controlled Messenger test account.

1. Log in as Super Admin.
2. Open Settings → Meta Platform.
3. Save and test the Meta App configuration.
4. Open Add Page and complete Facebook connect.
5. Complete Business Setup with the real catalog, policies, order fields, and delivery rules.
6. Configure that Page’s DeepSeek key, model, behavior, memory, and Test AI.
7. Configure that Page’s Telegram token, Chat ID, notification switches, and Test Telegram.
8. Configure that Page’s FX rate, pricing profiles, daily/monthly budget, and hard-limit policy.
9. Run Page Test and resolve every failed readiness check.
10. Publish the draft configuration, then choose Go Live.
11. Send a real Messenger test.
12. Verify the AI response uses only live Page business truth and the expected memory context.
13. Verify an order is created only after explicit confirmation, with current price and required fields.
14. Verify Telegram delivery and its outbox state.
15. Verify Page AI Usage shows calls, tokens, retry attempts, USD/BDT snapshots, and cost.
16. Repeat duplicate-webhook, ambiguous-confirmation, wrong-price, and manual-reply checks before opening normal traffic.

If any provider is unavailable, keep that Page paused. Inbound receipt and durable storage should continue; no order or notification should disappear silently.
