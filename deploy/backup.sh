#!/usr/bin/env bash
set -euo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || exit 1
exec 9>/run/lock/finguard-backup.lock
flock -n 9 || exit 0
cd /opt/finguard/current
[ -d /opt/finguard/data ] || exit 1
# Stop only this project's application for a consistent SQLite + JSON backup.
if [ -z "$(docker compose ps --status running -q app)" ]; then
  echo 'Application not running; backup skipped without restarting it.'; exit 1
fi
backup="/opt/finguard/backups/data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
trap 'docker compose start app' EXIT
docker compose stop -t 30 app
tar -czf "$backup.partial" -C /opt/finguard data
tar -tzf "$backup.partial" >/dev/null
mv "$backup.partial" "$backup"
printf 'Backup created: %s\n' "$backup"
