#!/bin/sh
# A friend's server for the Groups scene: "Maya’s place", a second Jellyfin with
# its own films and a Finesse in front of it (adopt mode, like a NAS that
# already runs Jellyfin), paired with the demo both ways. Run it after up.sh
# (it uses the image up.sh built). Safe to re-run; her films and settings stay.
#   sh demo/friend.sh
#   Maya's Finesse: http://localhost:8093/finesse (maya / FinesseFriend2026)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${TOUR_WORK:-$HOME/.cache/finesse-tour}
DEMO=${TOUR_DEMO:-$WORK/demo}
export TOUR_DEMO="$DEMO"
FR=$DEMO/friend
IMG=$(sed -n "s/.*image: '\(jellyfin\/jellyfin:[^']*\)'.*/\1/p" "$HERE/../../../server/src/stack/catalog.ts" | head -1)
mkdir -p "$FR/jellyfin" "$FR/finesse" "$FR/data/media/movies"
python3 "$HERE/friend.py" "$DEMO"

# Behind a proxy (see up.sh): Maya's Jellyfin needs it too, for posters and details.
PROXY=""
if [ -n "${TOUR_APP_PROXY:-}" ]; then
  PROXY="-e HTTPS_PROXY=$TOUR_APP_PROXY -e HTTP_PROXY=$TOUR_APP_PROXY -e NO_PROXY=localhost,127.0.0.1,finesse,tour-friend"
fi
if [ -n "${TOUR_APP_CA_BUNDLE:-}" ]; then
  PROXY="$PROXY -v $TOUR_APP_CA_BUNDLE:/etc/finesse-ca.pem:ro -e SSL_CERT_FILE=/etc/finesse-ca.pem"
fi
if ! docker inspect tour-friend-jf >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  docker run -d --name tour-friend-jf --restart unless-stopped --network finesse -p 8098:8096 \
    -v "$FR/jellyfin:/config" -v "$FR/data/media:/data/media:ro" -e TZ=Europe/London $PROXY "$IMG" >/dev/null
fi
node --disable-warning=ExperimentalWarning "$HERE/friend.mjs" jellyfin

docker rm -f tour-friend >/dev/null 2>&1 || true
docker run -d --name tour-friend --restart unless-stopped --network finesse -p 8093:8080 \
  -v "$FR/finesse:/config" --env-file "$FR/finesse.env" \
  -e JELLYFIN_URL=http://tour-friend-jf:8096 -e FINESSE_PUBLIC_URL=http://tour-friend:8080 -e TZ=Europe/London finesse:dev >/dev/null
for _ in $(seq 1 60); do curl -sf localhost:8093/api/health >/dev/null && break; sleep 1; done
node --disable-warning=ExperimentalWarning "$HERE/friend.mjs" pair
echo "Maya’s place is at http://localhost:8093/finesse (maya / FinesseFriend2026)"
