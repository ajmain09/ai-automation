# VPS deployment

Target: `https://ai.growthifyx.space` on `161.248.201.222`.

Only Caddy publishes ports 80 and 443. PostgreSQL and the Next.js app have no host port bindings.

## Upload or clone

Run: `sudo mkdir -p /opt/growthifyx-ai-sales`, `sudo chown "$USER":"$USER" /opt/growthifyx-ai-sales`, `cd /opt/growthifyx-ai-sales`, then `git clone <REPOSITORY_URL> .`. For an upload, copy the repository contents there and keep `.env` out of the upload.

## Production environment

Run `cp .env.production.example .env`, `chmod 600 .env`, `openssl rand -base64 48`, `openssl rand -base64 32`, then edit `.env`. Put the first random value in `SESSION_SECRET` and the second in `APP_ENCRYPTION_KEY`; they must differ. Set `POSTGRES_PASSWORD`, URL-encode it inside `DATABASE_URL`, set `ADMIN_EMAIL`, and keep `DEV_PREVIEW=false`.

Meta values may be blank for post-login configuration in Settings → Meta Platform. Do not add a global DeepSeek key or Telegram token.

## First start

Run `chmod +x scripts/*.sh`, `docker compose config --quiet`, then `./scripts/deploy.sh`, then `docker compose ps`. Startup is PostgreSQL health → app `prisma migrate deploy` → app health → worker and Caddy. A migration failure keeps the app unhealthy and is visible in `docker compose logs app`.

## Super Admin bootstrap

Run `docker compose run --rm -it app npm run admin:bootstrap`. This is idempotent: it creates the only Super Admin when none exists, hashes with Argon2id, never prints the password, and does nothing if an admin already exists. For a non-interactive terminal, pass `ADMIN_PASSWORD` only through a protected process environment; never put it in Git or shell history.

## HTTPS and health verification

Run `curl --fail --silent --show-error https://ai.growthifyx.space/api/health`, `curl --fail --silent --show-error -I https://ai.growthifyx.space/privacy`, `curl --fail --silent --show-error -I https://ai.growthifyx.space/data-deletion`, `curl --fail --silent --show-error -I https://ai.growthifyx.space/api/meta/oauth/callback`, and `docker compose ps`. The callback may return parameter validation without OAuth parameters; that still verifies routing. Confirm the certificate is for `ai.growthifyx.space`, not the VPS IP.

## Future update

Run `git pull --ff-only` followed by `./scripts/update.sh` from `/opt/growthifyx-ai-sales`.

## Logs

Use `docker compose logs --tail=200 app`, `docker compose logs --tail=200 worker`, `docker compose logs --tail=200 postgres`, and `docker compose logs --tail=200 caddy`.

## Backup and restore

Backups must be outside the PostgreSQL data directory. Run `sudo mkdir -p /var/backups/growthifyx`, `sudo chown "$USER":"$USER" /var/backups/growthifyx`, `./scripts/backup-postgres.sh /var/backups/growthifyx`, and `find /var/backups/growthifyx -maxdepth 1 -type f -printf '%f\n' | sort`.

Restore is guarded: `./scripts/restore-postgres.sh /var/backups/growthifyx/growthifyx-YYYYMMDD-HHMMSS.dump --confirm-restore`, then `docker compose up -d worker caddy`. After the first VPS restore, verify login, Page isolation, configuration lifecycle, orders, outbox state, and AI Usage. Do not claim restore success before that smoke test.
