#!/bin/sh
# (Re)starts the two demo servers from your working copy:
#   :8080  "finesse"      the demo household (its folders: <demo>/root and <demo>/data)
#   :8091  "finesse-wiz"  a fresh, unconfigured server for the setup-wizard scenes
# Rebuilds the app and the image first, so the tour always shows your latest code.
# Folders are kept; the wizard server always starts fresh.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
DEMO=${TOUR_DEMO:-${TOUR_WORK:-$HOME/.cache/finesse-tour}/demo}
WIZ=$DEMO/wizard
mkdir -p "$DEMO/root" "$DEMO/data"

cd "$REPO"
npm run -s build >/dev/null
npm run -s server:build >/dev/null
docker build -q --target prebuilt -t finesse:dev . >/dev/null

docker network inspect finesse >/dev/null 2>&1 || docker network create finesse >/dev/null
# Only the demo needs this (setup.json points its indexer here): a tiny fake Newznab indexer.
if ! docker inspect fake-indexer >/dev/null 2>&1; then
  docker run -d --name fake-indexer --restart unless-stopped --network finesse -v "$HERE:/srv:ro" node:22-alpine node /srv/fake-indexer.cjs >/dev/null
fi

# Behind an outbound proxy? Set TOUR_APP_PROXY=http://<host-ip>:<port> so the apps can reach the internet,
# and TOUR_APP_CA_BUNDLE=<file> if the proxy inspects TLS with its own certificate.
PROXY=""
if [ -n "${TOUR_APP_PROXY:-}" ]; then
  PROXY="-e FINESSE_APP_HTTPS_PROXY=$TOUR_APP_PROXY -e FINESSE_APP_HTTP_PROXY=$TOUR_APP_PROXY -e FINESSE_APP_NO_PROXY=fake-indexer"
fi
if [ -n "${TOUR_APP_CA_BUNDLE:-}" ]; then
  PROXY="$PROXY -e FINESSE_APP_CA_BUNDLE=$TOUR_APP_CA_BUNDLE"
fi

docker rm -f finesse finesse-wiz >/dev/null 2>&1 || true
# shellcheck disable=SC2086
docker run -d --name finesse --restart unless-stopped --network finesse --network-alias finesse -p 8080:8080 \
  -v /var/run/docker.sock:/var/run/docker.sock -v "$DEMO/root:$DEMO/root" -v "$DEMO/data:$DEMO/data" \
  -e FINESSE_ROOT="$DEMO/root" -e FINESSE_DATA="$DEMO/data" -e FINESSE_CONFIG_DIR="$DEMO/root/config/finesse" \
  -e PUID="$(id -u)" -e PGID="$(id -g)" -e TZ=Europe/London $PROXY finesse:dev >/dev/null

rm -rf "${WIZ:?}"
mkdir -p "$WIZ/root" "$WIZ/data"
docker run -d --name finesse-wiz -p 8091:8080 \
  -v /var/run/docker.sock:/var/run/docker.sock -v "$WIZ/root:$WIZ/root" -v "$WIZ/data:$WIZ/data" \
  -e FINESSE_ROOT="$WIZ/root" -e FINESSE_DATA="$WIZ/data" -e FINESSE_CONFIG_DIR="$WIZ/root/config/finesse" \
  -e FINESSE_NETWORK=finesse-wiz -e FINESSE_CONTAINER=finesse-wiz -e FINESSE_MAINTENANCE=off -e TZ=Europe/London finesse:dev >/dev/null

for _ in $(seq 1 60); do
  curl -sf localhost:8080/api/health >/dev/null && curl -sf localhost:8091/api/health >/dev/null && { echo "demo servers are up"; exit 0; }
  sleep 1
done
echo "the demo servers didn't come up — see: docker logs finesse" >&2
exit 1
