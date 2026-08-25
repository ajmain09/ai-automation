#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
backup_dir="${1:-${BACKUP_DIR:-/var/backups/growthifyx}}"
daily_retention="${DAILY_RETENTION:-7}"
weekly_retention="${WEEKLY_RETENTION:-4}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
stamp="$(date -u +%Y%m%d-%H%M%S)"
daily_file="$backup_dir/growthifyx-$stamp.dump"

docker compose exec -T postgres sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$daily_file"
chmod 600 "$daily_file"
find "$backup_dir" -maxdepth 1 -type f -name 'growthifyx-*.dump' -printf '%T@ %p\n' | sort -nr | tail -n +$((daily_retention + 1)) | cut -d' ' -f2- | xargs -r rm -f

if [[ "$(date -u +%u)" == "7" ]]; then
  weekly_file="$backup_dir/weekly-$stamp.dump"
  cp --preserve=mode,timestamps "$daily_file" "$weekly_file"
  chmod 600 "$weekly_file"
  find "$backup_dir" -maxdepth 1 -type f -name 'weekly-*.dump' -printf '%T@ %p\n' | sort -nr | tail -n +$((weekly_retention + 1)) | cut -d' ' -f2- | xargs -r rm -f
fi
echo "Backup written to $daily_file"
