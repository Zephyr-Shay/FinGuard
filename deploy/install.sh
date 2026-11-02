#!/usr/bin/env bash
set -euo pipefail
umask 077
[ "$(id -u)" -eq 0 ] || { echo 'Please run with sudo bash deploy/install.sh'; exit 1; }
source_dir="$(cd "$(dirname "$0")/.." && pwd)"
release=/opt/finguard/releases/1.0.0-final-20261101
if [ -e "$release" ] || [ -e /opt/finguard/current ]; then
  echo 'FinGuard installation already exists. Stop here: do not overwrite it. Share this output.'; exit 1
fi
docker info >/dev/null
docker compose version
# Build before changing runtime directories; do not use unofficial mirror scripts.
docker compose -f "$source_dir/compose.yaml" build
install -d -m 755 /opt/finguard/releases
install -d -m 700 -o 1000 -g 1000 /opt/finguard/data
install -d -m 700 /opt/finguard/backups
cp -a "$source_dir" "$release"
ln -s "$release" /opt/finguard/current
cd "$release"
docker compose run --rm --no-deps app node provision.mjs
docker compose run --rm --no-deps app node tools/provision-demo.mjs --create
docker compose up -d --wait --wait-timeout 90
curl --fail --silent http://127.0.0.1:4317/api/health
install -m 644 deploy/finguard-backup.service /etc/systemd/system/finguard-backup.service
install -m 644 deploy/finguard-backup.timer /etc/systemd/system/finguard-backup.timer
systemctl daemon-reload
systemctl enable --now finguard-backup.timer
printf '\nReady for private testing. Credentials: /opt/finguard/data/测试账号-请勿公开.txt\n'
printf 'Do not open port 4317 to the Internet.\n'
