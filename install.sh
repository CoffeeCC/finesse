#!/usr/bin/env bash
# Finesse installer — your own streaming service, set up for you.
#
#   curl -fsSL https://raw.githubusercontent.com/CoffeeCC/finesse/master/install.sh | bash
#
# Installs Docker if needed (with your OK), starts the Finesse container and
# prints the address + one-time setup code. Everything else (Jellyfin, the
# *arrs, SABnzbd, qBittorrent behind a VPN…) is set up from the browser.
#
# Options:
#   --data DIR       where movies, shows, music and downloads live
#   --root DIR       where Finesse keeps app settings      (default /opt/finesse;
#                    on TrueNAS, a folder on your pool)
#   --port N         port for the Finesse web app            (default 8080)
#   --version V      Finesse version to install              (default latest)
#   --setup FILE     apply a setup document right away (no browser needed)
#   --yes            don't ask; accept the defaults (installs Docker if missing)
#   --uninstall      remove Finesse and the apps it installed (your files stay)
#   --help           show this
#
# Re-running is safe: an existing install is left running and its details
# are printed again.

set -euo pipefail

REPO_IMAGE="${FINESSE_IMAGE_REPO:-ghcr.io/coffeecc/finesse}"
VERSION="latest"
IMAGE=""
ROOT="/opt/finesse"
ROOT_SET=0
DATA=""
PORT=8080
SETUP_FILE=""
YES=0
UNINSTALL=0
NAME="finesse"
NETWORK="finesse"
DOCS="https://github.com/CoffeeCC/finesse/blob/master/docs/install.md"
TRUENAS_DOCS="https://github.com/CoffeeCC/finesse/blob/master/docs/truenas.md"

# ---------- output ----------
if [ -t 1 ]; then
  B=$'\e[1m'; D=$'\e[2m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'
else
  B=""; D=""; G=""; Y=""; R=""; C=""; N=""
fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '  %s✔%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '\n%s✖ %s%s\n' "$R" "$*" "$N" >&2; printf '  Help: %s\n' "$DOCS" >&2; exit 1; }

# Prompts read from the terminal even when this script is piped into bash.
ask() { # ask "Question" default → echoes the answer
  local q="$1" def="${2:-}" ans=""
  if [ "$YES" = 1 ] || [ ! -r /dev/tty ]; then echo "$def"; return; fi
  printf '  %s%s%s %s[%s]%s ' "$B" "$q" "$N" "$D" "$def" "$N" >/dev/tty
  read -r ans </dev/tty || true
  echo "${ans:-$def}"
}
confirm() { # confirm "Question" (default yes)
  local a
  a=$(ask "$1 (Y/n)" "y")
  case "$a" in [nN]*) return 1 ;; *) return 0 ;; esac
}

usage() {
  if [ -r "$0" ] && head -1 "$0" | grep -q bash; then sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'
  else say "See $DOCS"; fi
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --data) DATA="$2"; shift 2 ;;
    --root) ROOT="$2"; ROOT_SET=1; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --version) VERSION="${2#v}"; shift 2 ;;
    --image) IMAGE="$2"; shift 2 ;;
    --setup) SETUP_FILE="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --help|-h) usage ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done
IMAGE="${IMAGE:-$REPO_IMAGE:$VERSION}"

# ---------- privileges ----------
SUDO=""
if [ "$(id -u)" != 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "Run this as root, or install sudo."
  SUDO="sudo"
fi
docker_() { $SUDO docker "$@"; }

printf '\n%sFinesse%s%s.%s  your own streaming service\n' "$B" "$N" "$C" "$N"

# ---------- uninstall ----------
if [ "$UNINSTALL" = 1 ]; then
  step "Removing Finesse"
  ids=$(docker_ ps -aq --filter label=finesse.managed=true || true)
  [ -n "$ids" ] && docker_ rm -f $ids >/dev/null && ok "Removed the apps Finesse installed"
  docker_ rm -f "$NAME" >/dev/null 2>&1 && ok "Removed the Finesse container" || true
  docker_ network rm "$NETWORK" >/dev/null 2>&1 || true
  say ""
  say "  Your media, downloads and app settings were NOT deleted."
  say "  They're in the folders you chose (default $ROOT). Delete them yourself if you want them gone."
  exit 0
fi

# ---------- this machine ----------
step "Checking this machine"
[ "$(uname -s)" = "Linux" ] || die "This installer is for Linux. (Windows and macOS: see the install guide.)"
case "$(uname -m)" in
  x86_64|amd64) ok "Linux on x86-64" ;;
  aarch64|arm64) ok "Linux on ARM64" ;;
  *) die "Finesse needs a 64-bit x86 or ARM computer (this is $(uname -m))." ;;
esac
# Decimal GB everywhere (like the setup wizard and disk labels), not GiB.
mem_gb=$(awk '/MemTotal/ { printf "%d", $2*1024/1e9 + 0.5 }' /proc/meminfo 2>/dev/null || echo 0)
if [ "${mem_gb:-0}" -lt 2 ]; then warn "Only ${mem_gb} GB of memory — 4 GB or more is recommended."; else ok "${mem_gb} GB memory, $(nproc 2>/dev/null || echo '?') CPU cores"; fi

if [ ! -e /dev/net/tun ]; then
  $SUDO modprobe tun >/dev/null 2>&1 || true
fi
if [ -e /dev/net/tun ]; then ok "VPN support (/dev/net/tun)"; else warn "No /dev/net/tun — Usenet works, but torrents (which need the VPN) won't be offered."; fi

# TrueNAS SCALE: its system drive is replaced on every update, so nothing may live
# outside a pool (/mnt/…), and Docker comes from its Apps service.
TRUENAS=0
if command -v midclt >/dev/null 2>&1 || [ -d /usr/lib/python3/dist-packages/middlewared ]; then
  TRUENAS=1
  ok "TrueNAS SCALE"
  say "  ${D}To see Finesse on TrueNAS's Apps page with your other apps, install it from there instead:${N}"
  say "  ${D}$TRUENAS_DOCS${N}"
fi

# ---------- Docker ----------
step "Docker"
if [ "$TRUENAS" = 1 ] && ! docker_ info >/dev/null 2>&1; then
  die "Docker isn't running yet. In TrueNAS, open Apps and choose a pool for apps (Apps → Configuration → Choose Pool), then run this again."
fi
if ! command -v docker >/dev/null 2>&1; then
  say "  Finesse runs every app in Docker, which isn't installed."
  if confirm "Install Docker now (from get.docker.com)?"; then
    command -v curl >/dev/null 2>&1 || die "curl is needed to install Docker."
    # Quietly, into a log: get.docker.com prints dozens of lines of its own.
    DOCKER_LOG=$(mktemp /tmp/finesse-docker-install.XXXXXX)
    say "  Installing Docker (a minute or two; details in $DOCKER_LOG)…"
    if curl -fsSL https://get.docker.com | $SUDO sh >"$DOCKER_LOG" 2>&1; then
      ok "Docker installed"
    else
      tail -n 15 "$DOCKER_LOG" >&2
      die "Docker didn't install (the last lines are above; full log: $DOCKER_LOG). Install it yourself (docs.docker.com/engine/install) and run this again."
    fi
  else
    die "Install Docker (docs.docker.com/engine/install), then run this again."
  fi
fi
if ! docker_ info >/dev/null 2>&1; then
  $SUDO systemctl enable --now docker >/dev/null 2>&1 || $SUDO service docker start >/dev/null 2>&1 || true
  sleep 2
  docker_ info >/dev/null 2>&1 || die "Docker is installed but not running. Start it (sudo systemctl start docker) and run this again."
fi
ok "Docker $(docker_ version --format '{{.Server.Version}}' 2>/dev/null)"

# ---------- already installed? ----------
existing=$(docker_ ps -a --filter "name=^/${NAME}$" --format '{{.Status}}' || true)
if [ -n "$existing" ]; then
  step "Finesse is already installed"
  case "$existing" in Up*) ok "Running ($existing)" ;; *) docker_ start "$NAME" >/dev/null && ok "Started it again" ;; esac
  PORT=$(docker_ port "$NAME" 8080/tcp 2>/dev/null | head -1 | sed 's/.*://' || echo "$PORT")
  PORT=${PORT:-8080}
  say "  ${D}Updates happen from inside Finesse (Settings → Updates). To start over: $0 --uninstall${N}"
else
  # ---------- folders ----------
  step "Where things go"
  if [ "$TRUENAS" = 1 ] && [ "$ROOT_SET" = 0 ]; then
    pool=$(ls -d /mnt/*/ 2>/dev/null | grep -v -e '/mnt/\.' -e 'ix-apps' | head -1)
    [ -n "$pool" ] || die "No pool found under /mnt. Create one in TrueNAS (Storage), then run this again."
    ROOT=$(ask "Settings folder (on a pool)" "${pool%/}/finesse")
  fi
  if [ -z "$DATA" ]; then
    say "  Movies, shows, music and downloads need space. Disks with the most room:"
    df -P -k -x tmpfs -x devtmpfs -x overlay -x squashfs -x efivarfs 2>/dev/null | awk 'NR>1 { printf "%d GB free  %s\n", $4*1024/1e9, $6 }' | sort -rn | head -4 | sed 's/^/    /'
    DATA=$(ask "Media & downloads folder" "$ROOT/data")
  fi
  ROOT="${ROOT%/}"; DATA="${DATA%/}"
  case "$ROOT$DATA" in *" "*) die "Please use folder paths without spaces." ;; esac
  if [ "$TRUENAS" = 1 ]; then
    for d in "$ROOT" "$DATA"; do
      case "$d" in /mnt/?*) ;; *) die "On TrueNAS, keep Finesse's folders on a pool (under /mnt/), not $d: TrueNAS updates replace everything else. Use --root /mnt/<pool>/finesse --data /mnt/<pool>/media." ;; esac
    done
  fi
  $SUDO mkdir -p "$ROOT/config" "$DATA" || die "Couldn't create $ROOT or $DATA"
  free_gb=$(df -P -k "$DATA" | awk 'NR==2 { printf "%d", $4*1024/1e9 }')
  ok "Settings in $ROOT, media in $DATA (${free_gb} GB free)"
  [ "${free_gb:-0}" -lt 50 ] && warn "That's not much room — a single 4K movie can be 50 GB."

  # The apps run as this user so your files stay yours.
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    PUID=$(id -u "$SUDO_USER"); PGID=$(id -g "$SUDO_USER")
  elif [ "$(id -u)" != 0 ]; then
    PUID=$(id -u); PGID=$(id -g)
  elif [ "$TRUENAS" = 1 ]; then
    PUID=568; PGID=568   # TrueNAS's "apps" user, like its own apps
  else
    PUID=1000; PGID=1000
  fi
  $SUDO chown "$PUID:$PGID" "$ROOT/config" "$DATA" 2>/dev/null || true

  TZ_NAME=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)
  TZ_NAME=${TZ_NAME:-UTC}

  # ---------- port ----------
  port_busy() { (command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$1 )" | grep -q ":$1 ") || (echo >/dev/tcp/127.0.0.1/"$1") 2>/dev/null; }
  want=$PORT
  while port_busy "$PORT"; do PORT=$((PORT + 1)); [ "$PORT" -gt $((want + 20)) ] && die "Ports $want–$PORT are all in use. Pick one with --port."; done
  [ "$PORT" != "$want" ] && warn "Port $want is in use — Finesse will use $PORT."

  # ---------- start ----------
  step "Starting Finesse"
  say "  ${D}Downloading $IMAGE…${N}"
  docker_ pull "$IMAGE" >/dev/null 2>&1 || [ -n "$(docker_ images -q "$IMAGE")" ] || die "Couldn't download $IMAGE. Check the internet connection (and the version, if you gave one)."
  docker_ network inspect "$NETWORK" >/dev/null 2>&1 || docker_ network create "$NETWORK" --label finesse.managed=true >/dev/null
  docker_ run -d --name "$NAME" \
    --restart unless-stopped \
    --network "$NETWORK" --network-alias finesse \
    -p "$PORT:8080" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$ROOT:$ROOT" -v "$DATA:$DATA" \
    -e FINESSE_ROOT="$ROOT" -e FINESSE_DATA="$DATA" -e FINESSE_CONFIG_DIR="$ROOT/config/finesse" \
    -e PUID="$PUID" -e PGID="$PGID" -e TZ="$TZ_NAME" \
    "$IMAGE" >/dev/null || die "Docker couldn't start Finesse."
  ok "Started (port $PORT)"
fi

# ---------- wait until it answers ----------
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 || die "Finesse didn't answer on port $PORT. See: sudo docker logs $NAME"

# The address people at home reach this machine on: the one the default route
# leaves from, unless that's a VPN; else the first real network card's.
# (`hostname -I` lists Docker bridges and Tailscale too, in no useful order.)
virtual_if='^(docker|br-|veth|virbr|cni|flannel|cali|tailscale|tun|tap|wg|zt|lo)'
IP=""
route_dev=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="dev") print $(i+1)}')
if [ -n "$route_dev" ] && ! printf '%s' "$route_dev" | grep -Eq "$virtual_if"; then
  IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") print $(i+1)}')
fi
[ -n "$IP" ] || IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $2, $4}' | grep -Ev "$virtual_if" | head -1 | awk '{sub("/.*","",$2); print $2}')
[ -n "$IP" ] || IP=$(hostname -I 2>/dev/null | awk '{print $1}')
IP=${IP:-localhost}
URL="http://$IP:$PORT"

# ---------- headless setup ----------
if [ -n "$SETUP_FILE" ]; then
  [ -r "$SETUP_FILE" ] || die "Can't read $SETUP_FILE"
  step "Applying $SETUP_FILE"
  docker_ exec -i "$NAME" finesse setup apply - <"$SETUP_FILE" || die "Setup stopped — fix the problem above and run: sudo docker exec -i $NAME finesse setup apply - < $SETUP_FILE"
  say ""
  say "  ${G}${B}Your server is ready.${N}  Open ${B}$URL${N} and sign in."
  exit 0
fi

CODE=$(docker_ exec "$NAME" finesse setup-code 2>/dev/null || true)
say ""
if [ -n "$CODE" ]; then
  say "  ${G}${B}Finesse is running.${N} Finish setting it up in your browser:"
  say ""
  say "      ${B}$URL/finesse/setup?code=$CODE${N}"
  say ""
  say "  Setup code: ${B}$CODE${N}   ${D}(show it again: sudo docker exec $NAME finesse setup-code)${N}"
  if command -v qrencode >/dev/null 2>&1; then qrencode -t ANSIUTF8 "$URL/finesse/setup?code=$CODE"; fi
else
  say "  ${G}${B}Finesse is running${N} at ${B}$URL${N}"
fi
say ""
say "  ${D}Health check any time: sudo docker exec $NAME finesse doctor${N}"
say "  ${D}Finesse is free. Tips welcome (ETH): 0xfe70da78fd755baae45389662f3c71825dfc55f7${N}"
say ""
