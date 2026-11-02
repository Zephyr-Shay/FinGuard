#!/usr/bin/env bash
set -euo pipefail
umask 077
exec 9>/run/lock/finguard-ip-renew.lock
flock -n 9 || exit 0
base=/opt/finguard-ip-access
# Preserve all existing certificate renewals on this shared gateway.
renew_status=0
docker run --rm --network host -v "$base/letsencrypt:/etc/letsencrypt" -v "$base/webroot:/var/www/certbot" certbot/certbot:v5.4.0 renew --quiet --no-random-sleep-on-renew || renew_status=$?
# Reload certificates that did renew even if a different domain failed.
docker exec finguard-ip-gateway nginx -t
docker exec finguard-ip-gateway nginx -s reload
python3 "$base/check-tls.py" --status-file "$base/tls-status.json"
exit "$renew_status"
