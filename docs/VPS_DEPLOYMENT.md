# VPS deployment runbook

Target: `https://ai.growthifyx.space`.

## Exact first command on the VPS

From a fresh VPS, run this first:

```bash
sudo mkdir -p /opt/growthifyx-ai-sales && sudo chown "$USER":"$USER" /opt/growthifyx-ai-sales
```

Then enter the directory and clone or upload the repository:

```bash
cd /opt/growthifyx-ai-sales
git clone <REPOSITORY_URL> .
```

Do not upload `.env` from a workstation.

## Configure production

```bash
cp .env.production.example .env
chmod 600 .env
openssl rand -base64 48
openssl rand -base64 32
```

Put the two random values in different `SESSION_SECRET` and `APP_ENCRYPTION_KEY` fields. Set `POSTGRES_PASSWORD`, URL-encode that password in `DATABASE_URL`, set `ADMIN_EMAIL`, and keep `DEV_PREVIEW=false`. The database hostname must remain `postgres` because it is the Compose service name.

Do not add a global DeepSeek key or Telegram token. Those credentials are per Page and remain behind the encryption boundary. Meta is the only global platform integration.

## First deployment

```bash
chmod +x scripts/*.sh docker/*.sh
./scripts/deploy.sh
docker compose ps
```

The script validates Compose, builds the app and worker image, validates the production environment, starts PostgreSQL, waits for its health check, starts the app so it runs `prisma migrate deploy`, waits for app health, then starts the worker and Caddy. A migration failure leaves app unhealthy and prints app logs.

## Super Admin bootstrap

After app health succeeds:

```bash
docker compose run --rm -it app npm run admin:bootstrap
```

Set `ADMIN_EMAIL` in `.env` to avoid the email prompt. The password is entered interactively, must be at least 12 characters, is Argon2id-hashed, is never printed, and is never stored in the repository. The command is idempotent and refuses to create a second administrator. For a non-interactive terminal, pass `ADMIN_PASSWORD` through a protected process environment only.

## HTTPS and route verification

```bash
curl --fail --silent --show-error https://ai.growthifyx.space/api/health
curl --fail --silent --show-error -I https://ai.growthifyx.space/privacy
curl --fail --silent --show-error -I https://ai.growthifyx.space/data-deletion
curl --fail --silent --show-error -I https://ai.growthifyx.space/api/meta/oauth/callback
docker compose ps
```

The OAuth callback may return a parameter-validation response without OAuth parameters; that still verifies routing. Confirm the certificate covers `ai.growthifyx.space`. PostgreSQL must have no host port mapping.

## Updates and logs

Before an update, preserve the current commit: `git rev-parse HEAD`. Then run `git pull --ff-only` followed by `./scripts/update.sh`. The update makes a database backup first by default. To inspect services:

```bash
docker compose logs --tail=200 app
docker compose logs --tail=200 worker
docker compose logs --tail=200 postgres
docker compose logs --tail=200 caddy
```

The Compose JSON log driver retains five 10 MB files per service; Caddy also emits structured JSON access logs.

## Backups

```bash
sudo mkdir -p /var/backups/growthifyx
sudo chown "$USER":"$USER" /var/backups/growthifyx
./scripts/backup-postgres.sh /var/backups/growthifyx
find /var/backups/growthifyx -maxdepth 1 -type f -printf '%f\n' | sort
```

Keep this directory outside the PostgreSQL volume and copy backups to protected off-host storage according to the VPS policy. The script keeps seven daily and four weekly custom-format dumps.

## Deferred non-destructive integration checks

Run these only after the deployment is healthy. They verify runtime state and credentials without creating an order, sending a Messenger reply, or sending a Telegram notification. A command that cannot run is a failed/deferred check, not a PASS.

```bash
cd /opt/growthifyx-ai-sales
export PAGE_ID='REPLACE_WITH_THE_META_PAGE_ID'

# Compose, database reachability, migrations, and worker readiness
docker compose config --quiet
docker compose ps
docker compose exec -T postgres sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose run --rm --no-deps app npx prisma migrate status
curl --fail --silent --show-error https://ai.growthifyx.space/api/health

# Read-only PostgreSQL concurrency probe; this rolls back and does not touch app rows.
docker compose exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('"'"'vps-memory-concurrency-probe'"'"', 0)); SELECT 1 AS memory_lock_probe; ROLLBACK;"'

# The authenticated readiness route must be run with the Super Admin session cookie.
# Use the browser Network panel after opening the Page readiness screen and replay:
# GET /api/pages/$PAGE_ID/readiness

# DeepSeek: use the Page's authenticated, non-sending Test AI action. It must return
# sent:false and a real provider result; a missing credential or fallback is not PASS.
# Telegram: inspect the Page Telegram settings screen/API and confirm tokenConfigured:true
# without using the POST test action. Provider credential validity remains deferred until
# an operator explicitly authorizes a real provider check.
```

Order draft/confirm/update/cancel, migration locking under load, and real provider credential checks require an isolated test Page/customer and explicit operator authorization because they can create business data or external notifications. Run them only in that isolated scope; never run them against the live customer Page. The backend order path itself is covered by the local automated order tests, while the commands above verify the deployed runtime boundaries.

Meta values and permissions are documented in [META_SETUP.md](META_SETUP.md). The first real Page procedure is [FIRST_LIVE_PAGE.md](FIRST_LIVE_PAGE.md).
