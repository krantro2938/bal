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
blue="${BAL_BLUE_PORT:-18090}"
green="${BAL_GREEN_PORT:-18091}"
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
  # --delay-updates puts every new file in place at the end, so meta.json never points at a
  # video that is still uploading; replaced files are removed only after that.
  rsync -a --delete-after --delay-updates --info=stats1 --exclude '*.part*' var/media/ "$host":/srv/bal/media/
fi

if ! ssh "$host" "docker image inspect $mod >/dev/null 2>&1"; then
  echo "==> shipping $mod"
  docker save "$mod" | gzip -1 | ssh "$host" 'gunzip | docker load'
fi
ssh "$host" "docker network create bal >/dev/null 2>&1 || true
if [ \"\$(docker inspect -f '{{.Config.Image}}' bal-mod 2>/dev/null)\" != '$mod' ]; then
  docker rm -f bal-mod >/dev/null 2>&1 || true
  docker run -d --name bal-mod --network bal --restart unless-stopped --read-only --memory 256m $mod >/dev/null
fi"

echo "==> shipping image"
docker save "$tag" bal:latest | gzip -1 | ssh "$host" 'gunzip | docker load'

# Zero downtime: the host's Caddy proxies to two ports (deploy/Caddyfile) and uses whichever is up.
# The new version starts on the free port as bal-blue (18090) or bal-green (18091); once it answers
# /healthz the old one is stopped gracefully (SIGTERM: it finishes requests in flight, Caddy retries
# the rest on the new one). If the new one never gets healthy it is removed and the old one keeps going.
echo "==> switching over"
ssh "$host" "set -e
caddy_has() { curl -fsS http://127.0.0.1:2019/config/ 2>/dev/null | grep -q \"127.0.0.1:\$1\" || grep -qs \"127.0.0.1:\$1\" /etc/caddy/Caddyfile; }
if ! caddy_has $blue || ! caddy_has $green; then
  echo 'Caddy does not proxy to both $blue and $green yet: update its site block from deploy/Caddyfile and reload Caddy first.'
  exit 1
fi
if docker ps -q --filter name=^bal-blue\$ | grep -q .; then old=bal-blue new=bal-green newport=$green
elif docker ps -q --filter name=^bal-green\$ | grep -q .; then old=bal-green new=bal-blue newport=$blue
elif docker ps -q --filter name=^bal\$ | grep -q .; then old=bal new=bal-green newport=$green   # before blue/green
else old= new=bal-blue newport=$blue; fi
docker rm -f \$new >/dev/null 2>&1 || true
docker run -d --name \$new --restart unless-stopped \
  --env-file /srv/bal/bal.env \
  -e BAL_MODERATION_URL=http://bal-mod:8000 \
  --network bal \
  -p 127.0.0.1:\$newport:8080 \
  -v /srv/bal/media:/data/media:ro \
  -v /srv/bal/db:/data/db \
  --read-only --tmpfs /tmp \
  --memory 300m \
  $tag >/dev/null
for i in \$(seq 60); do curl -fsS http://127.0.0.1:\$newport/healthz >/dev/null 2>&1 && break; sleep 0.5; done
if ! curl -fsS http://127.0.0.1:\$newport/healthz >/dev/null 2>&1; then
  echo \"\$new did not get healthy; keeping \${old:-nothing} running. Its log:\"
  docker logs --tail 30 \$new; docker rm -f \$new >/dev/null; exit 1
fi
echo \"\$new is healthy on :\$newport\"
# Give Caddy's health check a moment to see it before the old one goes.
sleep 3
if [ -n \"\$old\" ]; then docker stop -t 20 \$old >/dev/null && docker rm \$old >/dev/null && echo \"stopped \$old\"; fi
docker image prune -f >/dev/null"
