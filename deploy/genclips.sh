#!/usr/bin/env bash
# Generate short, offline preview clips for movies and place them where the
# Finesse nginx serves them (dist/previews/<jellyfinId>.mp4) + a manifest.json.
# Runs ffmpeg inside the Jellyfin container (it has /movies mounted + ffmpeg),
# stages to the jellyfin config dir, then moves to the finesse dist.
# Usage (on the TrueNAS host):  sudo bash genclips.sh [maxCount]
LIMIT="${1:-100000}"
BASE=http://localhost:8096
AUTH=$(curl -s -X POST "$BASE/Users/AuthenticateByName" -H "Content-Type: application/json" -H 'X-Emby-Authorization: MediaBrowser Client="x", Device="x", DeviceId="clipgen", Version="1"' -d '{"Username":"Admin","Pw":"toor"}')
TOKEN=$(echo "$AUTH" | jq -r .AccessToken); JFUID=$(echo "$AUTH" | jq -r .User.Id)
DEST=/mnt/HDDs/Applications/finesse/dist/previews
STAGE=/mnt/HDDs/Applications/jellyfin/config/previews
mkdir -p "$DEST"
n=0; made=0
while IFS=$'\t' read -r id path ticks; do
  [ "$n" -ge "$LIMIT" ] && break
  n=$((n+1))
  [ -f "$DEST/$id.mp4" ] && continue
  [ -z "$path" ] && continue
  off=$(( ticks/10000000/5 )); [ "$off" -lt 30 ] && off=30
  docker exec ix-jellyfin-jellyfin-1 sh -c "mkdir -p /config/previews && nice -n 19 /usr/lib/jellyfin-ffmpeg/ffmpeg -nostdin -y -ss $off -i \"$path\" -t 20 -vf scale=-2:480 -c:v libx264 -crf 30 -preset veryfast -profile:v high -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart /config/previews/$id.mp4" >/dev/null 2>&1
  if [ -f "$STAGE/$id.mp4" ]; then mv -f "$STAGE/$id.mp4" "$DEST/$id.mp4"; made=$((made+1)); fi
  ls "$DEST"/*.mp4 2>/dev/null | sed "s#.*/##; s/\.mp4\$//" | jq -R . | jq -s . > "$DEST/manifest.json"
done < <(curl -s "$BASE/Users/$JFUID/Items?IncludeItemTypes=Movie&Recursive=true&Fields=Path&Limit=100000" -H "X-Emby-Token: $TOKEN" | jq -r ".Items[] | [.Id, .Path, (.RunTimeTicks|tostring)] | @tsv")
echo "processed=$n made=$made total_clips=$(ls "$DEST"/*.mp4 2>/dev/null | wc -l)"
