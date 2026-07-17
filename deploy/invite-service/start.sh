#!/bin/sh
# Run on TrueNAS host (or any machine that can reach Jellyfin).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${INVITE_ENV:-/mnt/HDDs/Applications/finesse/invite-service.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
fi
export JELLYFIN_URL="${JELLYFIN_URL:-http://192.168.1.121:8096}"
export INVITES_DB="${INVITES_DB:-/mnt/HDDs/Applications/finesse/data/invites.db}"
export INVITE_PORT="${INVITE_PORT:-30501}"
export INVITE_LISTEN="${INVITE_LISTEN:-0.0.0.0}"
mkdir -p "$(dirname "$INVITES_DB")"
exec python3 "$DIR/server.py"
