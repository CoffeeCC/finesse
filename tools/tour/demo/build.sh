#!/bin/sh
# Builds the demo household from nothing: freely licensed films, a music library,
# homebrew games, a Finesse server set up from setup.json, and a lived-in
# household (profiles, history, resume points, My List). Safe to re-run: each
# step skips what's already there. Takes 20–30 minutes the first time.
#   sh demo/build.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${TOUR_WORK:-$HOME/.cache/finesse-tour}
DEMO=${TOUR_DEMO:-$WORK/demo}
export TOUR_WORK="$WORK" TOUR_DEMO="$DEMO"
IMG=$(sed -n "s/.*image: '\(jellyfin\/jellyfin:[^']*\)'.*/\1/p" "$HERE/../../../server/src/stack/catalog.ts" | head -1)
FF() { docker run --rm --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg -v "$DEMO:$DEMO" -w "$DEMO/src" "$IMG" -hide_banner -loglevel error -y "$@"; }
step() { echo "$(date +%T) $*"; }
mkdir -p "$DEMO/src" "$DEMO/data" "$DEMO/root"

step "films (Blender Foundation, CC BY)"
cd "$DEMO/src"
[ -f sintel.mp4 ] || curl -fsSL -o sintel.mp4 https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4
[ -f bbb.mov ] || curl -fsSL -o bbb.mov https://download.blender.org/peach/trailer/trailer_480p.mov
[ -f ed.mov ] || curl -fsSL -o ed.mov https://download.blender.org/ED/elephantsdream-480-h264-st-aac.mov
[ -f sintel-r.mp4 ] || FF -i sintel.mp4 -c copy -movflags +faststart sintel-r.mp4
[ -f bbb-r.mp4 ] || FF -i bbb.mov -vf scale=854:480 -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart bbb-r.mp4
[ -f ed-r.mp4 ] || FF -i ed.mov -c copy -movflags +faststart ed-r.mp4
python3 "$HERE/library.py" "$DEMO"

step "music (album details from MusicBrainz, generated audio)"
python3 "$HERE/music.py" "$DEMO"
docker run --rm --entrypoint sh -v "$DEMO:$DEMO" "$IMG" "$DEMO/music.sh"

step "games (homebrew from Homebrew Hub)"
python3 "$HERE/games.py" "$DEMO"

step "demo servers"
sh "$HERE/up.sh"

if [ "$(curl -s localhost:8080/api/finesse | python3 -c 'import json,sys;print(json.load(sys.stdin)["setup"]["state"])')" != ready ]; then
  step "setting up the demo server (about 10 minutes)"
  docker exec -i finesse finesse setup apply - < "$HERE/setup.json"
fi

step "waiting for the library to finish scanning"
for _ in $(seq 1 90); do
  node "$HERE/ids.mjs" >/dev/null 2>&1 && break
  sleep 10
done
node "$HERE/ids.mjs"

step "household"
python3 "$HERE/seed.py" "$DEMO"
step "done — the demo is at http://localhost:8080/finesse (alex / FinesseDemo2026)"
