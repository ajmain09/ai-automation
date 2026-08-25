# Recovery and rollback

## Application rollback

If an update fails its app, worker, Caddy, or public health check:

```bash
docker compose ps
docker compose logs --tail=200 app worker caddy
git log --oneline -5
git switch --detach <known-good-commit>
./scripts/deploy.sh
```

Use the commit saved before the update. Do not delete the PostgreSQL volume. After the known-good build is healthy, run the public route checks and verify the first Page remains paused until readiness is confirmed.

## Worker recovery

The worker is stateless. PostgreSQL jobs are durable and use leases, retry limits, expiry, and dead-letter states. A worker restart releases expired leases on the next claim cycle:

```bash
docker compose restart worker
docker compose ps
docker compose logs --tail=200 worker
```

Do not manually edit job rows as a first response. Review dead-letter Issues and correct the provider or configuration cause before retrying through the operator flow.

## PostgreSQL backup

Run backups outside the database data directory:

```bash
./scripts/backup-postgres.sh /var/backups/growthifyx
```

The output is a PostgreSQL custom-format dump with mode `600`. The script refuses to retain an empty dump and retains seven daily plus four weekly copies.

## PostgreSQL restore

Restore is destructive and requires an approved maintenance window. Keep an additional backup before starting. The command stops app, worker, and Caddy, leaves PostgreSQL running, restores the selected dump, applies committed Prisma migrations, and starts services only after health checks pass:

```bash
./scripts/restore-postgres.sh /var/backups/growthifyx/growthifyx-YYYYMMDD-HHMMSS.dump --confirm-restore
```

After restore, verify login, Page isolation, draft/live configuration lifecycle, order snapshots, Telegram outbox state, and Page AI Usage. A restore smoke test is VPS-only and must not be marked complete from local checks.

## Admin recovery

There is no default production password. Use the existing short-lived, single-use recovery-token operator flow, set a new password of at least 12 characters, invalidate the token, and review the `admin.password_reset` audit entry. Never place a password in source control, logs, or a committed environment file.
