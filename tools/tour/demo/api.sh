#!/bin/sh
# api.sh METHOD PATH [JSON] — calls the demo Finesse as its own service account
# (the key is read from the demo's settings and never printed).
#   sh api.sh GET /api/system/status
DEMO=${TOUR_DEMO:-${TOUR_WORK:-$HOME/.cache/finesse-tour}/demo}
KEY=$(python3 -c "import json;print(json.load(open('$DEMO/root/config/finesse/finesse.json'))['jellyfin']['apiKey'])")
AUTH="MediaBrowser Client=\"demo\", Device=\"demo\", DeviceId=\"demo\", Version=\"1\", Token=\"$KEY\""
if [ -n "${3:-}" ]; then curl -s -X "$1" -H "Authorization: $AUTH" -H 'Content-Type: application/json' -d "$3" "http://localhost:8080$2"
else curl -s -X "$1" -H "Authorization: $AUTH" "http://localhost:8080$2"; fi
