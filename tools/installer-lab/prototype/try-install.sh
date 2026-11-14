#!/bin/bash
# Tries a game download the way Finesse's game store will: checks its checksums, identifies the
# installer, unpacks it or installs it silently in a sealed sandbox (no network, nothing else
# mounted), then starts the game and takes screenshots. Nothing runs outside the sandbox.
#
#   sudo bash /mnt/HDDs/Applications/finesse/edge-installers/try-install.sh "<download folder>"
#
# Results and screenshots: \\Server\Games\finesse-test-results\<name>\
set -euo pipefail
HERE=/mnt/HDDs/Applications/finesse/edge-installers
SERVER_CODE=/mnt/HDDs/Applications/finesse/dev-games
RESULTS=/mnt/HDDs/Games/finesse-test-results
[ $# -ge 1 ] && [ -d "$1" ] || { echo "Usage: sudo bash $0 \"<folder with the installer>\""; exit 1; }
DL=$(cd "$1" && pwd)
NAME=$(basename "$DL" | tr -c 'A-Za-z0-9_.-' '_' | sed 's/_*$//')
mkdir -p "$HERE/out/real-$NAME" "$RESULTS/$NAME"
chmod 777 "$HERE/out/real-$NAME"

echo "== Step 1: checksums and what the installer is"
docker run --rm --network none --user 950:950 -v "$SERVER_CODE":/w:ro -v "$HERE":/e -v "$DL":/dl:ro \
  node:22 node /e/src/plan.ts /dl "/e/out/real-$NAME/plan.env" | grep -v 'checking '

echo "== Step 2: unpack or install in the sandbox, then start the game"
docker run --rm --network none --memory 8g --cpus 6 --user 1000:1000 -e PLAN="/e/out/real-$NAME/plan.env" \
  -v "$HERE":/e -v "$DL":/dl:ro finesse-installer-proto timeout 3300 bash /e/src/auto-install.sh /dl "$NAME" \
  | tee "$HERE/out/real-$NAME/result.txt" || true

cp -f "$HERE/out/real-$NAME"/*.png "$HERE/out/real-$NAME/result.txt" "$RESULTS/$NAME/" 2>/dev/null || true
echo "== Results and screenshots: \\\\Server\\Games\\finesse-test-results\\$NAME"
