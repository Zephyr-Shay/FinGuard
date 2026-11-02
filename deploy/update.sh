#!/usr/bin/env bash
set -euo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || { echo 'Run with sudo bash deploy/update.sh'; exit 1; }
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
release=/opt/finguard/releases/1.0.0-demo-reset-20261102-r5
old="$(readlink -f /opt/finguard/current)"
case "$old" in /opt/finguard/releases/*) ;; *) echo 'Current release missing or unexpected; stop.'; exit 1;; esac
[ -f "$old/compose.yaml" ] && [ -d /opt/finguard/data ] || exit 1
[ ! -e "$release" ] || { echo 'Release directory already exists; stop and inspect rather than overwrite.'; exit 1; }
if docker image inspect finguard:1.27.0 >/dev/null 2>&1; then
 docker build --network=none -f "$source_dir/Dockerfile.upgrade" -t finguard:1.0.0-demo-reset-20261102-r5 "$source_dir"
else
 docker compose -f "$source_dir/compose.yaml" build
fi
exec 9>/run/lock/finguard-backup.lock
flock -w 120 9
cp -a "$source_dir" "$release"
restart_old=0
phase=prepare
recover(){
 code=$?
 if [ "$restart_old" -eq 1 ]; then
  echo 'Update did not finish; attempting to restart previous code. User data was not restored or deleted.'
  docker compose -f "$old/compose.yaml" up -d || true
 fi
 if [ "$phase" = new ]; then
  echo 'V1.0 may have committed SQLite business records. Do NOT start V1.27 or restore its JSON snapshots. Keep the data and inspect this release and its backup.'
 fi
 exit "$code"
}
trap recover EXIT
restart_old=1
docker compose -f "$old/compose.yaml" stop -t 30 app
backup="/opt/finguard/backups/pre-1.0.0-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -czf "$backup.partial" -C /opt/finguard data
tar -tzf "$backup.partial" >/dev/null
mv "$backup.partial" "$backup"
docker compose -f "$release/compose.yaml" run --rm --no-deps app node tools/account-update.mjs --check-weak
docker compose -f "$release/compose.yaml" run --rm --no-deps app node tools/provision-demo.mjs --create
# Once the new app starts, SQLite is authoritative. An automatic JSON-era code
# rollback could discard transactions, so only pre-start failures restart old code.
restart_old=0
phase=new
# Maintenance/backup services must also select the SQLite-aware release before
# it can accept writes. A failed health wait must not leave current on old code.
ln -s "$release" /opt/finguard/current.next
mv -Tf /opt/finguard/current.next /opt/finguard/current
docker compose -f "$release/compose.yaml" up -d --no-build --wait --wait-timeout 90
restart_old=0
phase=complete
curl -fsS http://127.0.0.1:4317/api/health
printf '\nUpdated to V1.0.0. Existing accounts and records kept. Backup: %s\n' "$backup"
