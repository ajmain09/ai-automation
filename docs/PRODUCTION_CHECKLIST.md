# Production checklist

- [ ] Set a real PostgreSQL URL, random session secret, and explicit admin password; remove demo data.
- [ ] Configure Meta App credentials, redirect URI, verify token, Page permissions, and webhook subscription.
- [ ] Configure DeepSeek key/model/rates and verify per-Page AI usage records.
- [ ] Configure Telegram through the encrypted settings boundary and verify Page override/global fallback.
- [ ] Put Caddy behind the real domain and HTTPS certificate.
- [ ] Run Page readiness checks and resolve every failed check before Go Live.
- [ ] Test anti-repeat, unknown policy, wrong price, false-positive order, explicit confirmation, duplicate webhook, stale reply, and manual collision cases.
- [ ] Run a real Telegram delivery test and verify retry/idempotency behavior.
- [ ] Take a backup, perform the first restore smoke test, and retain seven daily/four weekly backups.

AI never confirms an order. Historical confirmed order snapshots and revisions remain after catalog changes or cancellation.
