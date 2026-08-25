#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] || { echo "Missing .env." >&2; exit 1; }
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
  echo "$service did not become healthy after the update." >&2
  docker compose ps >&2 || true
  docker compose logs --tail=100 "$service" >&2 || true
  return 1
}

docker compose config --quiet
if [[ "${SKIP_BACKUP:-false}" != "true" ]]; then
  "$(dirname "${BASH_SOURCE[0]}")/backup-postgres.sh" "${BACKUP_DIR:-/var/backups/growthifyx}"
fi
docker compose build app worker
docker compose run --rm --no-deps app node_modules/.bin/tsx scripts/validate-production-env.ts --environment
docker compose up -d --no-deps app
wait_for_health app 60
docker compose up -d --no-deps worker caddy
wait_for_health worker 30
wait_for_health caddy 30
docker compose ps
echo "Update completed. If application verification fails, follow docs/RECOVERY.md."
