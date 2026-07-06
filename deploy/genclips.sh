#!/usr/bin/env bash
# Generate short, multi-resolution offline preview clips for movies AND episodes,
# placed where the Finesse nginx serves them:
#   dist/previews/<id>.mp4          480p base  — always present (back-compat)
#   dist/previews/<id>.720.mp4      720p tier  — only if the source is ≥720 tall
#   dist/previews/<id>.1080.mp4     1080p tier — only if the source is ≥1080 tall
#   dist/previews/manifest.json     ["<id>", ...]          base-clip ids
#   dist/previews/manifest-hd.json  {"<id>":[720,1080]}    HD tiers present
# The client picks the tier matching each account's Preview-quality setting and
# falls back down the ladder for titles that haven't been re-encoded yet.
#
# ffmpeg runs inside the Jellyfin container (it has /movies + /tv mounted). Each
# file is skipped if already present, so re-runs are incremental & resumable.
# Types are processed IN ORDER (movies first) and items run N-at-a-time so a big
# library finishes in hours, not days. Each ffmpeg is nice -19 so it only eats
# otherwise-idle CPU and never starves Jellyfin.
# Usage (on the TrueNAS host):  sudo bash genclips.sh [maxCount] [types] [jobs]
#   maxCount  cap items processed (default: all)
#   types     space-separated, in order (default: "Movie Episode")
#   jobs      parallel encodes (default: 6)
LIMIT="${1:-100000}"
TYPES="${2:-Movie Episode}"
MAXJOBS="${3:-6}"
BASE=http://localhost:8096
AUTH=$(curl -s -X POST "$BASE/Users/AuthenticateByName" -H "Content-Type: application/json" -H 'X-Emby-Authorization: MediaBrowser Client="x", Device="x", DeviceId="clipgen", Version="1"' -d '{"Username":"Admin","Pw":"toor"}')
TOKEN=$(echo "$AUTH" | jq -r .AccessToken); JFUID=$(echo "$AUTH" | jq -r .User.Id)
DEST=/mnt/HDDs/Applications/finesse/dist/previews
STAGE=/mnt/HDDs/Applications/jellyfin/config/previews
CTR=ix-jellyfin-jellyfin-1
mkdir -p "$DEST"

# encode <path> <offsetSec> <height> <crf> <outfile>
encode() {
  local path="$1" off="$2" h="$3" crf="$4" out="$5"
  [ -f "$DEST/$out" ] && return 0
  docker exec "$CTR" sh -c "mkdir -p /config/previews && nice -n 19 /usr/lib/jellyfin-ffmpeg/ffmpeg -nostdin -y -ss $off -i \"$path\" -t 20 -vf scale=-2:$h -c:v libx264 -crf $crf -preset veryfast -profile:v high -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart /config/previews/$out" >/dev/null 2>&1
  [ -f "$STAGE/$out" ] && mv -f "$STAGE/$out" "$DEST/$out"
}

# process_item <id> <path> <ticks> <height> — runs its tiers serially; called in
# the background by the dispatch loop so up to MAXJOBS items encode at once.
process_item() {
  local id="$1" path="$2" ticks="$3" height="${4:-0}"
  [ -z "$path" ] && return
  local off=$(( ticks/10000000/5 )); [ "$off" -lt 30 ] && off=30
  encode "$path" "$off" 480 30 "$id.mp4"
  [ "$height" -ge 720 ]  && encode "$path" "$off" 720  26 "$id.720.mp4"
  [ "$height" -ge 1080 ] && encode "$path" "$off" 1080 24 "$id.1080.mp4"
}

# Atomic manifest rebuild from whatever clips exist on disk right now. The name
# list goes in $DEST (guaranteed writable — clips land there) rather than /tmp,
# which can be left owned by another user across runs and block the write.
rebuild_manifests() {
  local names="$DEST/.clipnames"
  ls "$DEST"/*.mp4 2>/dev/null | sed 's#.*/##; s/\.mp4$//' > "$names"
  grep -vE '\.(720|1080)$' "$names" | jq -R . | jq -s . > "$DEST/manifest.json.tmp" \
    && mv -f "$DEST/manifest.json.tmp" "$DEST/manifest.json"
  awk -F. '/\.(720|1080)$/ { h=$NF; print substr($0,1,length($0)-length(h)-1)" "h }' "$names" \
    | jq -R 'split(" ")|{id:.[0],h:(.[1]|tonumber)}' \
    | jq -s 'reduce .[] as $x ({}; .[$x.id] += [$x.h])' > "$DEST/manifest-hd.json.tmp" \
    && mv -f "$DEST/manifest-hd.json.tmp" "$DEST/manifest-hd.json"
}

# Concurrency via an explicit counter + `wait -n` (waits for any one job). We do
# NOT use $(jobs -r) here — that runs in a subshell that can't see the parent's
# background jobs, so the cap silently fails and spawns unbounded ffmpeg.
n=0; running=0
for TYPE in $TYPES; do
  while IFS=$'\t' read -r id path ticks height; do
    [ "$n" -ge "$LIMIT" ] && break
    n=$((n+1))
    process_item "$id" "$path" "$ticks" "$height" &
    running=$((running+1))
    if [ "$running" -ge "$MAXJOBS" ]; then wait -n; running=$((running-1)); fi
    [ $(( n % 50 )) -eq 0 ] && rebuild_manifests
  done < <(curl -s "$BASE/Users/$JFUID/Items?IncludeItemTypes=$TYPE&Recursive=true&Fields=Path,MediaStreams&Limit=100000" -H "X-Emby-Token: $TOKEN" | jq -r '.Items[] | [.Id, .Path, (.RunTimeTicks|tostring), ((.MediaStreams[]? | select(.Type=="Video") | .Height) // 0 | tostring)] | @tsv')
  wait; running=0
  rebuild_manifests
  echo "[$(date +%H:%M)] $TYPE done — processed=$n"
done
echo "ALL DONE processed=$n base=$(grep -vcE '\.(720|1080)$' /tmp/clipnames) hd720=$(ls "$DEST"/*.720.mp4 2>/dev/null|wc -l) hd1080=$(ls "$DEST"/*.1080.mp4 2>/dev/null|wc -l)"
