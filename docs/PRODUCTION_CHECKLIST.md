# Production deployment checklist

Target: `https://ai.growthifyx.space`

## Before deployment

- [ ] DNS `A` record for `ai.growthifyx.space` points to the VPS.
- [ ] `.env` was created from `.env.production.example`, is mode `600`, and is not committed.
- [ ] `NODE_ENV=production`, `DEV_PREVIEW=false`, canonical `APP_URL`, PostgreSQL values, `SESSION_SECRET`, `APP_ENCRYPTION_KEY`, and `ADMIN_EMAIL` are set.
- [ ] `SESSION_SECRET` and `APP_ENCRYPTION_KEY` are different random values.
- [ ] No Page token, DeepSeek key, Telegram token, or admin password was committed.
- [ ] Backup storage exists outside the PostgreSQL volume.

## Deployment acceptance

- [ ] `docker compose config --quiet` passes.
- [ ] `./scripts/deploy.sh` passes its environment preflight.
- [ ] PostgreSQL is healthy and has no host port binding.
- [ ] App startup completes `prisma migrate deploy`.
- [ ] `/api/health` returns HTTP 200 through Caddy.
- [ ] Worker and Caddy health checks are healthy.
- [ ] Only host ports 80 and 443 are published.
- [ ] `docker compose logs` contain no credentials.
- [ ] The Super Admin is created with `docker compose run --rm -it app npm run admin:bootstrap`.

## Meta and first Page

- [ ] Meta dashboard values exactly match `docs/META_SETUP.md`.
- [ ] Meta App credentials are configured in Global Settings > Meta Platform.
- [ ] The first Page passes the three visible onboarding steps and readiness checks in `docs/FIRST_LIVE_PAGE.md`.
- [ ] Real provider tests are performed only after the Page is configured and kept paused until verified.

## Recovery readiness

- [ ] A backup is created with `scripts/backup-postgres.sh`.
- [ ] Backup retention is seven daily and four weekly dumps.
- [ ] Restore smoke testing is completed on the VPS; it is not a local claim.
- [ ] Rollback and worker restart commands in `docs/RECOVERY.md` are available to the operator.

Docker runtime, live PostgreSQL migration/concurrency, Caddy certificate/domain, Meta, AI provider, Telegram, and restore smoke tests remain VPS validations.
