# Production checklist

Canonical URL: `https://ai.growthifyx.space`

## Before the first VPS start

- [ ] DNS `A` record for `ai.growthifyx.space` points to `161.248.201.222`.
- [ ] `.env` was created from `.env.production.example`; it is not committed.
- [ ] `APP_URL`, `NODE_ENV=production`, PostgreSQL values, `SESSION_SECRET`, and `APP_ENCRYPTION_KEY` are set.
- [ ] `SESSION_SECRET` and `APP_ENCRYPTION_KEY` are different cryptographically random values.
- [ ] No `ADMIN_PASSWORD`, DeepSeek key, Telegram token, Meta Page token, or other secret was added to Git.
- [ ] Meta app values are either safe bootstrap fallbacks in `.env` or will be entered after login in Settings → Meta Platform.

## First boot

- [ ] `docker compose config --quiet` succeeds.
- [ ] PostgreSQL is healthy and has no host port binding.
- [ ] The app migration entrypoint completes with `prisma migrate deploy`.
- [ ] `/api/health` returns HTTP 200.
- [ ] Worker and Caddy are healthy/running.
- [ ] `https://ai.growthifyx.space/login` loads with a valid certificate.
- [ ] `docker compose run --rm -it app npm run admin:bootstrap` creates the one Super Admin.

## Meta and Page readiness

- [ ] Settings → Meta Platform contains the Meta App ID, App Secret, and Verify Token.
- [ ] The Meta callback, webhook, privacy, and data-deletion URLs exactly match `docs/META_SETUP.md`.
- [ ] OAuth state, webhook verification, and X-Hub-Signature-256 checks pass.
- [ ] Page discovery, encrypted Page token storage, Page subscription, reconnect, and revoked-access behavior are tested.
- [ ] Each Page passes readiness before Go Live.

## Per-Page operations

- [ ] DeepSeek key/model/behavior/memory/balance settings are configured in the Page workspace.
- [ ] Telegram token, Chat ID, notification switches, and Test Telegram are configured in the Page workspace.
- [ ] FX, pricing snapshots, daily/monthly budgets, hard limit, and provider balance are reviewed per Page.
- [ ] AI usage confirms Page isolation, USD/BDT snapshots, retries, and only the affected Page pauses at its limit.
- [ ] Real Messenger, AI, memory, order, Telegram, and AI Usage checks pass for the first live Page.

## Resilience and recovery

- [ ] App, worker, PostgreSQL, and Caddy log commands have been reviewed for secret-free output.
- [ ] Restart, temporary database/provider outage, expired lease, dead-letter job, and budget-limit behavior are verified.
- [ ] A backup is created outside the PostgreSQL data directory.
- [ ] A restore smoke test is performed on the VPS; do not mark this item complete from local checks.
- [ ] Backup retention is seven daily and four weekly copies.
