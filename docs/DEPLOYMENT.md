# Deployment

Production topology is exactly four containers:

`Caddy -> app -> PostgreSQL`, with `worker` consuming the PostgreSQL job queue. Redis and external automation services are not part of this system. PostgreSQL uses the named persistent volume `growthifyx_postgres_data`; only Caddy publishes ports 80 and 443.

The VPS runbook is [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md). The first deployment sequence is:

1. Copy or clone the repository into `/opt/growthifyx-ai-sales`.
2. Create and protect `.env` from `.env.production.example`.
3. Run `./scripts/deploy.sh`.
4. Bootstrap the one Super Admin.
5. Verify public health and policy routes.

App startup validates production variables and applies committed migrations with `prisma migrate deploy` before becoming healthy. The worker starts only after app health, uses PostgreSQL leases/retries, and recovers expired running jobs on its next claim cycle.

Use `scripts/update.sh` for updates. It creates a backup first unless `SKIP_BACKUP=true` is explicitly supplied. Use `scripts/backup-postgres.sh` and the guarded restore command in `docs/RECOVERY.md` for database operations.

Local static checks do not claim Docker, live PostgreSQL, public HTTPS, Meta, DeepSeek, Telegram, or restore runtime success.
