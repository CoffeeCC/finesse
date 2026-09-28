#!/usr/bin/env bash
# Generate short, multi-resolution offline preview clips for movies AND episodes,
# placed where the Finesse nginx serves them:
#   dist/previews/<id>.mp4          480p base  — always present (back-compat)
#                                   (episodes: a 4-cut teaser — see encode_teaser)
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
: "${JF_USER:?Set JF_USER and JF_PASS to a Jellyfin administrator login}"
AUTH=$(curl -s -X POST "$BASE/Users/AuthenticateByName" -H "Content-Type: application/json" -H 'X-Emby-Authorization: MediaBrowser Client="x", Device="x", DeviceId="clipgen", Version="1"' -d "$(jq -n --arg u "$JF_USER" --arg p "${JF_PASS:-}" '{Username: $u, Pw: $p}')")
TOKEN=$(echo "$AUTH" | jq -r .AccessToken); JFUID=$(echo "$AUTH" | jq -r .User.Id)
DEST="${DEST:-/mnt/POOL/apps/finesse/dist/previews}"   # where the app is served from
STAGE="${STAGE:-/mnt/POOL/apps/jellyfin/config/previews}" # a folder the Jellyfin container can see
CTR=ix-jellyfin-jellyfin-1
mkdir -p "$DEST"

# encode <path> <offsetSec> <height> <crf> <outfile>
# A failed ffmpeg can leave a 0-byte file behind — only a non-empty result that
# ffmpeg reported as successful is ever published (and empties get retried).
encode() {
  local path="$1" off="$2" h="$3" crf="$4" out="$5"
  [ -s "$DEST/$out" ] && return 0
  if docker exec "$CTR" sh -c "mkdir -p /config/previews && nice -n 19 /usr/lib/jellyfin-ffmpeg/ffmpeg -nostdin -y -ss $off -i \"$path\" -t 20 -vf scale=-2:$h -c:v libx264 -crf $crf -preset veryfast -profile:v high -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart /config/previews/$out" >/dev/null 2>&1 \
    && [ -s "$STAGE/$out" ]; then
    mv -f "$STAGE/$out" "$DEST/$out"
  else
    rm -f "$STAGE/$out" "$DEST/$out"
  fi
}

# encode_teaser <path> <durSec> <height> <crf> <outfile>
# Episodes get a "next time on…" teaser instead of one continuous chunk: four
# 5s cuts from the FIRST HALF only (12/24/36/48% — spoiler-light), each with a
# quick fade, concatenated. Finesse plays it on the player's Up Next card. Falls
# back to the plain single-cut clip if the montage can't be built (e.g. a file
# with no audio track, or too short).
encode_teaser() {
  local path="$1" dur="$2" h="$3" crf="$4" out="$5"
  [ -s "$DEST/$out" ] && return 0
  local ins="" chains="" pairs="" i=0
  for pct in 12 24 36 48; do
    ins="$ins -ss $(( dur*pct/100 )) -t 5 -i \"$path\""
    chains="$chains[$i:v:0]scale=-2:$h,setsar=1,fps=24,format=yuv420p,fade=t=in:st=0:d=0.4,fade=t=out:st=4.6:d=0.4,setpts=PTS-STARTPTS[v$i];"
    chains="$chains[$i:a:0]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:st=0:d=0.4,afade=t=out:st=4.6:d=0.4,asetpts=PTS-STARTPTS[a$i];"
    pairs="$pairs[v$i][a$i]"
    i=$((i+1))
  done
  if docker exec "$CTR" sh -c "mkdir -p /config/previews && nice -n 19 /usr/lib/jellyfin-ffmpeg/ffmpeg -nostdin -y $ins -filter_complex '${chains}${pairs}concat=n=4:v=1:a=1[v][a]' -map '[v]' -map '[a]' -c:v libx264 -crf $crf -preset veryfast -profile:v high -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart /config/previews/$out" >/dev/null 2>&1 \
    && [ -s "$STAGE/$out" ]; then
    mv -f "$STAGE/$out" "$DEST/$out"
  else
    rm -f "$STAGE/$out" "$DEST/$out"
    encode "$path" "$(( dur/5 < 30 ? 30 : dur/5 ))" "$h" "$crf" "$out"
  fi
}

# process_item <type> <id> <path> <ticks> <height> — runs its tiers serially;
# called in the background by the dispatch loop so up to MAXJOBS items encode at once.
process_item() {
  local type="$1" id="$2" path="$3" ticks="$4" height="${5:-0}"
  [ -z "$path" ] && return
  local dur=$(( ticks/10000000 ))
  if [ "$type" = "Episode" ] && [ "$dur" -ge 120 ]; then
    encode_teaser "$path" "$dur" 480 30 "$id.mp4"
    [ "$height" -ge 720 ]  && encode_teaser "$path" "$dur" 720  26 "$id.720.mp4"
    [ "$height" -ge 1080 ] && encode_teaser "$path" "$dur" 1080 24 "$id.1080.mp4"
    return
  fi
  local off=$(( dur/5 )); [ "$off" -lt 30 ] && off=30
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
    process_item "$TYPE" "$id" "$path" "$ticks" "$height" &
    running=$((running+1))
    if [ "$running" -ge "$MAXJOBS" ]; then wait -n; running=$((running-1)); fi
    [ $(( n % 50 )) -eq 0 ] && rebuild_manifests
  done < <(curl -s "$BASE/Users/$JFUID/Items?IncludeItemTypes=$TYPE&Recursive=true&Fields=Path,MediaStreams&Limit=100000" -H "X-Emby-Token: $TOKEN" | jq -r '.Items[] | [.Id, .Path, (.RunTimeTicks|tostring), ((.MediaStreams[]? | select(.Type=="Video") | .Height) // 0 | tostring)] | @tsv')
  wait; running=0
  rebuild_manifests
  echo "[$(date +%H:%M)] $TYPE done — processed=$n"
done
echo "ALL DONE processed=$n base=$(grep -vcE '\.(720|1080)$' "$DEST/.clipnames") hd720=$(ls "$DEST"/*.720.mp4 2>/dev/null|wc -l) hd1080=$(ls "$DEST"/*.1080.mp4 2>/dev/null|wc -l)"
