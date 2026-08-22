# Recovery and backup

## Admin recovery

Issue a short-lived, single-use recovery token through the one-admin operator flow. Store only its SHA-256 hash. Set a new password of at least 12 characters, invalidate the token, and review the `admin.password_reset` audit entry. There is no default production password. Never write a password into source control or AI context.

## PostgreSQL backups

Use `scripts/backup-postgres.ps1` with `pg_dump`, encrypted storage, and a protected backup directory. Keep seven daily backups and four weekly backups. Keep backups outside the application container and test retention separately from application deployment.

Restore with `scripts/restore-postgres.ps1` only during an approved maintenance window. Stop app/worker writes, restore, run `prisma migrate deploy` if required, restart services, and verify Page isolation, login, configuration lifecycle, order snapshots, outbox state, and AI usage.

Actual PostgreSQL restore smoke testing is DEFERRED TO VPS; it is not claimed as locally tested.

The seed command creates or updates only the single administrator and does not create a demo Page. Create Page workspaces through the authenticated onboarding flow.
