#!/usr/bin/env bash
# Deploy to the VPS over SSH. The image is built here (the VPS has 2 GB RAM),
# streamed with `docker save | docker load`, and run behind the host's Caddy.
#
#   deploy/deploy.sh timeweb-ru            # image + media + restart
#   SKIP_MEDIA=1 deploy/deploy.sh timeweb-ru
#
# On the VPS: /srv/bal/media (prepared media, read-only in the container),
# /srv/bal/db (SQLite + session secret), /srv/bal/bal.env (see bal.env.example).
set -euo pipefail
host="${1:?usage: deploy/deploy.sh <ssh-host>}"
port="${BAL_HOST_PORT:-18090}"
cd "$(dirname "$0")/.."

tag="bal:$(git rev-parse --short HEAD)$(git diff --quiet || echo -dirty)"
echo "==> building $tag"
docker build -f deploy/Dockerfile -t "$tag" -t bal:latest .

echo "==> preparing $host"
ssh "$host" 'mkdir -p /srv/bal/media /srv/bal/db && chown -R 10001:10001 /srv/bal/db && test -f /srv/bal/bal.env || { echo "missing /srv/bal/bal.env (copy deploy/bal.env.example)"; exit 1; }'

if [ -z "${SKIP_MEDIA:-}" ]; then
  echo "==> syncing media (originals in var/raw stay local)"
  rsync -a --delete --info=stats1 --exclude '*.part*' var/media/ "$host":/srv/bal/media/
fi

echo "==> shipping image"
docker save "$tag" bal:latest | gzip -1 | ssh "$host" 'gunzip | docker load'

echo "==> restarting"
ssh "$host" "docker rm -f bal >/dev/null 2>&1 || true
docker run -d --name bal --restart unless-stopped \
  --env-file /srv/bal/bal.env \
  -p 127.0.0.1:$port:8080 \
  -v /srv/bal/media:/data/media:ro \
  -v /srv/bal/db:/data/db \
  --read-only --tmpfs /tmp \
  --memory 300m \
  $tag
sleep 2; docker ps --filter name=^bal\$ --format '{{.Status}}'; curl -fsS http://127.0.0.1:$port/healthz && echo ' healthy'
docker image prune -f >/dev/null"
