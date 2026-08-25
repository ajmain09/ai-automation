#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
backup_file="${1:-}"
[[ -n "$backup_file" && -f "$backup_file" ]] || { echo "Usage: $0 /path/to/backup.dump --confirm-restore" >&2; exit 1; }
[[ "${2:-}" == "--confirm-restore" ]] || { echo "Restore replaces live data. Re-run with --confirm-restore during an approved maintenance window." >&2; exit 1; }

docker compose stop app worker caddy
docker compose start postgres
docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$backup_file"
docker compose run --rm --no-deps app npx prisma migrate deploy
docker compose up -d app
echo "Restore completed. Wait for the app health check, then start worker and caddy with: docker compose up -d worker caddy"
