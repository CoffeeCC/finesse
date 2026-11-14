#!/bin/bash
# Step 2 of a hands-off install, inside the sandbox (no network). Reads plan.env from step 1 and
# decides everything else itself: no per-game hints.
#   tier 1  unpack with the tool for this installer type, find the game's program, start it
#   tier 2  if that didn't give a running game: run the installer silently, start the game
# "Starts" = still running after 20 s (software 3D is slow). A silent install counts as hung
# only after LIMIT seconds with no files being written; then everything in the sandbox stops.
# Usage: auto-install.sh <download folder> <name>
set -u
DL=$1 NAME=$2
OUT=/e/out/real-$NAME; mkdir -p "$OUT"
LIMIT=${LIMIT:-120}
source "${PLAN:-$DL/plan.env}"
export DISPLAY=:9
Xvfb :9 -screen 0 1280x720x24 +extension GLX >/dev/null 2>&1 &
sleep 1
say() { echo "   $*"; }

[ "$CHECKS_OK" = 1 ] || { say "STOP: the download didn't pass its checksums"; exit 1; }
[ -n "$INSTALLER" ] || { say "STOP: no installer in the download"; exit 1; }
EXE="$DL/$INSTALLER"

fresh_prefix() { local p="/tmp/prefix-$1"; cp -a /e/prefix "$p"; echo "$p"; }

# The game's program: skip installers, uninstallers, runtimes, crash reporters and helpers; prefer
# one named like the installer; else the biggest program left.
find_game() {
  local root=$1 hint
  hint=$(basename "$INSTALLER" | tr 'A-Z' 'a-z' | sed -E 's/[-_ .].*//')
  local list
  list=$(find "$root" -type f -iname '*.exe' 2>/dev/null \
    | grep -viE '/(unins[^/]*|setup[^/]*|install[^/]*|[^/]*redist[^/]*|vc_?redist[^/]*|dxsetup[^/]*|dotnet[^/]*|crash[^/]*|[^/]*report[^/]*|[^/]*helper[^/]*|updat[^/]*|7z[^/]*|elevate[^/]*|python[^/]*|ffmpeg[^/]*|[^/]*test[^/]*)\.exe$' \
    | grep -vi '/\$PLUGINSDIR/')
  [ -n "$list" ] || return
  local named
  named=$(echo "$list" | grep -i "/[^/]*${hint}[^/]*\.exe$" | head -1)
  if [ -n "$named" ] && [ -n "$hint" ]; then echo "$named"; return; fi
  echo "$list" | while read -r f; do echo "$(stat -c %s "$f") $f"; done | sort -rn | head -1 | cut -d' ' -f2-
}

starts() { # $1 prefix, $2 game exe, $3 shot name
  local pfx=$1 game=$2 shot=$3
  (cd "$(dirname "$game")" && WINEPREFIX=$pfx timeout 25 wine "$(basename "$game")" > "$OUT/$shot.log" 2>&1) &
  local job=$!
  sleep 20
  import -window root "$OUT/$shot.png" 2>/dev/null
  wait $job; local rc=$?
  WINEPREFIX=$pfx wineserver -k 2>/dev/null
  [ $rc = 124 ] && echo "STARTS (still running after 20 s)" || echo "won't start (exit $rc): $(grep -viE '^\s*$|fixme|err:ole|Xlib' "$OUT/$shot.log" | tail -1 | cut -c1-120)"
}

echo "== $NAME: $INSTALLER ($KIND)"

# ---- tier 1: unpack ----
X=/tmp/unpacked-$NAME; mkdir -p "$X"
t=$(date +%s)
case "$UNPACK" in
  innoextract) innoextract-git -s -d "$X" "$EXE" > "$OUT/unpack.log" 2>&1 ;;
  7z) 7z x -y -o"$X" "$EXE" > "$OUT/unpack.log" 2>&1 ;;
  msiextract) (cd "$X" && msiextract "$EXE") > "$OUT/unpack.log" 2>&1 ;;
  *) echo "no unpack tool" > "$OUT/unpack.log"; false ;;
esac
rc=$?
say "tier 1 unpack:  ${UNPACK:-none}, exit $rc in $(( $(date +%s) - t ))s, $(find "$X" -type f | wc -l) files, $(du -sh "$X" | cut -f1)"
tier1=no
if [ $rc = 0 ]; then
  game=$(find_game "$X")
  if [ -n "$game" ]; then
    say "tier 1 program: ${game#$X/}"
    pfx=$(fresh_prefix t1-$NAME)
    v=$(starts "$pfx" "$game" tier1); say "tier 1 game:    $v"
    [[ $v == STARTS* ]] && tier1=yes
  else say "tier 1 program: none found"; fi
fi
[ $tier1 = yes ] && { say "RESULT: ready, by unpacking (the installer never ran)"; exit 0; }

# ---- tier 2: silent install ----
pfx=$(fresh_prefix t2-$NAME)
case "$KIND" in
  inno) cmd=(wine "$EXE" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /ALLUSERS "/DIR=C:\\Games\\$NAME" "/LOG=C:\\setup.log") ;;
  nsis) cmd=(wine "$EXE" /S "/D=C:\\Games\\$NAME") ;;
  msi) cmd=(wine msiexec /i "$EXE" /qn /norestart "INSTALLDIR=C:\\Games\\$NAME" "TARGETDIR=C:\\Games\\$NAME") ;;
  *) say "RESULT: needs you (no silent switches known for $KIND)"; exit 2 ;;
esac
say "tier 2 command: ${cmd[*]/#$DL\//}"
t=$(date +%s)
WINEPREFIX=$pfx "${cmd[@]}" > "$OUT/silent.log" 2>&1 &
job=$!
last=-1 still=0 state=running
while kill -0 $job 2>/dev/null || pgrep -f 'wine.*(setup|\.tmp|msiexec|install)' >/dev/null; do
  sleep 10
  now=$(du -sb "$pfx/drive_c" 2>/dev/null | cut -f1)
  if [ "$now" = "$last" ]; then still=$((still + 10)); else still=0; fi
  last=$now
  [ $still -ge "$LIMIT" ] && { state=hung; break; }
  [ $(( $(date +%s) - t )) -ge 2700 ] && { state=hung; break; }
done
if [ $state = hung ]; then
  WINEPREFIX=$pfx wineserver -k 2>/dev/null
  say "tier 2 silent:  HUNG (no files written for ${LIMIT}s); everything in the sandbox stopped"
  say "RESULT: needs you"; exit 2
fi
wait $job; rc=$?
WINEPREFIX=$pfx timeout 60 wineserver -w
inst="$pfx/drive_c/Games/$NAME"
[ -d "$inst" ] || inst=$(find "$pfx/drive_c" -maxdepth 3 -type d -newer /e/prefix/system.reg -ipath '*program files*/*' 2>/dev/null | head -1)
say "tier 2 silent:  exit $rc in $(( $(date +%s) - t ))s, $(find "$inst" -type f 2>/dev/null | wc -l) files in ${inst#$pfx/drive_c/}"
game=$(find_game "$inst")
[ -n "$game" ] || { say "RESULT: didn't work (no game program after installing)"; exit 3; }
say "tier 2 program: ${game#$pfx/drive_c/}"
v=$(starts "$pfx" "$game" tier2); say "tier 2 game:    $v"
[[ $v == STARTS* ]] && say "RESULT: ready, by a silent install" || say "RESULT: didn't work (the game doesn't start)"
