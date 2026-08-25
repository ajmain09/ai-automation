#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] || { echo "Missing .env. Copy .env.production.example and fill every required value." >&2; exit 1; }

docker compose config --quiet
docker compose build app worker
docker compose up -d postgres

for _ in {1..30}; do
  status="$(docker compose ps -q postgres | xargs -r docker inspect -f '{{.State.Health.Status}}')"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker compose ps -q postgres | xargs -r docker inspect -f '{{.State.Health.Status}}')" == "healthy" ]] || { echo "PostgreSQL did not become healthy." >&2; exit 1; }

docker compose up -d app
for _ in {1..45}; do
  status="$(docker compose ps -q app | xargs -r docker inspect -f '{{.State.Health.Status}}')"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker compose ps -q app | xargs -r docker inspect -f '{{.State.Health.Status}}')" == "healthy" ]] || { docker compose logs --tail=100 app; exit 1; }

docker compose up -d worker caddy
docker compose ps
echo "Deployment started. Run docker compose logs --tail=100 app worker caddy to review the first boot."
