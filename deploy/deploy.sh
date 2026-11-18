#!/usr/bin/env bash
# Deploy to the VPS over SSH. The image is built here (the VPS has 2 GB RAM),
# streamed with `docker save | docker load`, and run behind the host's Caddy.
#
#   deploy/deploy.sh timeweb-ru            # image + media + restart
#   SKIP_MEDIA=1 deploy/deploy.sh timeweb-ru
#
# On the VPS: /srv/bal/media (prepared media, read-only in the container),
# /srv/bal/db (SQLite + session secret), /srv/bal/bal.env (see bal.env.example).
# A second container, bal-mod (moderation/), scores comments; it is shipped only
# when moderation/ changes, and bal reaches it over the private "bal" network.
set -euo pipefail
host="${1:?usage: deploy/deploy.sh <ssh-host>}"
port="${BAL_HOST_PORT:-18090}"
cd "$(dirname "$0")/.."

tag="bal:$(git rev-parse --short HEAD)$(git diff --quiet || echo -dirty)"
echo "==> building $tag"
docker build -f deploy/Dockerfile -t "$tag" -t bal:latest .

mod="bal-mod:$(git ls-files -s moderation | git hash-object --stdin | cut -c1-12)"
echo "==> building $mod"
docker build -q -t "$mod" moderation >/dev/null

echo "==> preparing $host"
ssh "$host" 'mkdir -p /srv/bal/media /srv/bal/db && chown -R 10001:10001 /srv/bal/db && test -f /srv/bal/bal.env || { echo "missing /srv/bal/bal.env (copy deploy/bal.env.example)"; exit 1; }'

if [ -z "${SKIP_MEDIA:-}" ]; then
  echo "==> syncing media (originals in var/raw stay local)"
  rsync -a --delete --info=stats1 --exclude '*.part*' var/media/ "$host":/srv/bal/media/
fi

if ! ssh "$host" "docker image inspect $mod >/dev/null 2>&1"; then
  echo "==> shipping $mod"
  docker save "$mod" | gzip -1 | ssh "$host" 'gunzip | docker load'
fi
ssh "$host" "docker network create bal >/dev/null 2>&1 || true
if [ \"\$(docker inspect -f '{{.Config.Image}}' bal-mod 2>/dev/null)\" != '$mod' ]; then
  docker rm -f bal-mod >/dev/null 2>&1 || true
  docker run -d --name bal-mod --network bal --restart unless-stopped --read-only --memory 200m $mod >/dev/null
fi"

echo "==> shipping image"
docker save "$tag" bal:latest | gzip -1 | ssh "$host" 'gunzip | docker load'

echo "==> restarting"
ssh "$host" "docker rm -f bal >/dev/null 2>&1 || true
docker run -d --name bal --restart unless-stopped \
  --env-file /srv/bal/bal.env \
  -e BAL_MODERATION_URL=http://bal-mod:8000 \
  --network bal \
  -p 127.0.0.1:$port:8080 \
  -v /srv/bal/media:/data/media:ro \
  -v /srv/bal/db:/data/db \
  --read-only --tmpfs /tmp \
  --memory 300m \
  $tag
sleep 2; docker ps --filter name=^bal\$ --format '{{.Status}}'; curl -fsS http://127.0.0.1:$port/healthz && echo ' healthy'
docker image prune -f >/dev/null"
