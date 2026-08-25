#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] || { echo "Missing .env." >&2; exit 1; }
docker compose config --quiet
docker compose build app worker
docker compose up -d --no-deps app

for _ in {1..45}; do
  status="$(docker compose ps -q app | xargs -r docker inspect -f '{{.State.Health.Status}}')"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
[[ "$(docker compose ps -q app | xargs -r docker inspect -f '{{.State.Health.Status}}')" == "healthy" ]] || { docker compose logs --tail=100 app; exit 1; }
docker compose up -d --no-deps worker caddy
docker compose ps
