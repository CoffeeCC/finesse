#!/bin/sh
# Records the whole tour in slow motion and makes the film, a small preview and
# the episodes. Resumable: a take that finished (it has cues.json) is kept, so
# delete takes/<name> to record it again.
#
#   sh record.sh            # everything
#   sh record.sh film       # just re-cut the film + episodes from existing takes
#
# Needs the demo servers running (demo/build.sh) and the narration made
# (ELEVENLABS_API_KEY=… node vo.mjs all).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${TOUR_WORK:-$HOME/.cache/finesse-tour}
DEMO=${TOUR_DEMO:-$WORK/demo}
TAKES=$WORK/takes
export TOUR_SLOWMO=${TOUR_SLOWMO:-6}
mkdir -p "$TAKES"
cd "$HERE"

seed() { python3 "$HERE/demo/seed.py" "$DEMO" >/dev/null || echo "seeding the demo failed"; }
take() { # name script
  if [ -f "$TAKES/$1/cues.json" ]; then echo "$(date +%T) $1: kept"; return 0; fi
  rm -rf "${TAKES:?}/$1"
  seed
  echo "$(date +%T) $1: recording (about ${3:-10} minutes)"
  timeout 5400 node "$2" "$TAKES/$1" 2>&1 | grep -E "✔|✖|frames|slow locate|game frames|Error" || true
  [ -f "$TAKES/$1/cues.json" ] || { echo "$(date +%T) $1: failed — see $TAKES/$1/fail-*.png"; exit 1; }
}

if [ "${1:-}" != film ]; then
  take desktop tour.mjs 40
  take phone phone.mjs 6
  take tv tv.mjs 6
  seed
fi

FILM=$WORK/film
echo "$(date +%T) making the film"
rm -rf "${FILM:?}"
node compose.mjs "$TAKES/desktop" "$TAKES/phone" "$TAKES/tv" "$FILM" 2>&1 | tail -6
[ -f "$FILM/finesse-tour.mp4" ] || exit 1
node poster.mjs "$FILM/poster-raw.jpg" "$FILM/tour-poster.jpg" "The tour · $(node -e "const c=require('$FILM/chapters.json');console.log(Math.round(c.at(-1).t/60))") minutes · narrated"
node chapters-md.mjs "$FILM/chapters.json" > "$FILM/chapters.md"

echo "$(date +%T) episodes"
rm -rf "${WORK:?}/episodes"
node episodes.mjs "$FILM" "$WORK/episodes" 2>&1 | tail -12
echo "$(date +%T) done:"
echo "  film      $FILM/finesse-tour.mp4 (+ 720p, poster, chapters.md)"
echo "  episodes  $WORK/episodes (EPISODES.md lists them)"
