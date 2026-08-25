#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
backup_file="${1:-}"
[[ -n "$backup_file" && -f "$backup_file" ]] || { echo "Usage: $0 /path/to/backup.dump --confirm-restore" >&2; exit 1; }
[[ "${2:-}" == "--confirm-restore" ]] || { echo "Restore replaces live data. Re-run with --confirm-restore during an approved maintenance window." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is required on the VPS." >&2; exit 1; }

wait_for_health() {
  local service="$1"
  local attempts="${2:-60}"
  local container status
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    container="$(docker compose ps -q "$service")"
    if [[ -n "$container" ]]; then
      status="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || true)"
      [[ "$status" == "healthy" ]] && return 0
    fi
    sleep 2
  done
  echo "$service did not become healthy." >&2
  docker compose logs --tail=100 "$service" >&2 || true
  return 1
}

docker compose config --quiet
docker compose stop app worker caddy
docker compose up -d postgres
wait_for_health postgres 45
docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$backup_file"
docker compose run --rm --no-deps app node_modules/.bin/tsx scripts/validate-production-env.ts --environment
docker compose run --rm --no-deps app npx prisma migrate deploy
docker compose up -d app
wait_for_health app 60
docker compose up -d worker caddy
wait_for_health worker 30
wait_for_health caddy 30
docker compose ps
echo "Restore completed. Perform the smoke checks in docs/RECOVERY.md before reopening normal traffic."
