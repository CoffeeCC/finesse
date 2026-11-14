#!/bin/bash
# Puts every test installer in out/NN-*/ through the game store's install tiers, offline, each in
# a fresh copy of the Wine prefix so nothing one test installs can help another:
#   tier 1  unpack with innoextract (never runs the installer), then start the game
#   tier 2  run the installer silently (/VERYSILENT /ALLUSERS), then start the game
# "Starts" means the game is still running after 10 seconds. Screenshots go to out/shots/.
set -u
OUT=/e/out
mkdir -p "$OUT/shots"
export DISPLAY=:9
Xvfb :9 -screen 0 1024x600x24 >/dev/null 2>&1 &
sleep 1

fresh_prefix() { # $1 = name; prints the prefix path
  local p="/tmp/prefix-$1"
  cp -a /e/prefix "$p"
  echo "$p"
}

starts() { # $1 = prefix, $2 = folder with game.exe, $3 = screenshot name; prints the verdict
  local pfx=$1 dir=$2 shot=$3
  [ -f "$dir/game.exe" ] || { echo "no game.exe"; return; }
  (cd "$dir" && WINEPREFIX=$pfx timeout 12 wine game.exe >/dev/null 2>&1) &
  local job=$!
  sleep 10
  import -window root "$OUT/shots/$shot.png" 2>/dev/null
  wait $job
  local rc=$?
  WINEPREFIX=$pfx wineserver -k 2>/dev/null
  case $rc in
    124) echo "STARTS (still running after 10 s)";;
    2) echo "won't start: exit 2 (its game data is missing)";;
    3) echo "won't start: exit 3 (the runtime it needs isn't installed)";;
    *) echo "won't start: exit $rc";;
  esac
}

for dir in "$OUT"/[0-9][0-9]-*/; do
  case=$(basename "$dir")
  [[ "$case" < "${FROM:-00}" ]] && continue
  exe="$dir/setup.exe"
  [ -f "$exe" ] || { echo "== $case: no setup.exe"; continue; }
  echo "== $case  ($(ls "$dir" | wc -l) file(s), $(du -sh "$dir" | cut -f1))"

  # tier 1: unpack
  x="/tmp/x-$case"; mkdir -p "$x"
  t=$(date +%s)
  innoextract-git -s -d "$x" "$exe" > "/tmp/ie-$case.log" 2>&1; rc=$?
  t=$(( $(date +%s) - t ))
  files=$(find "$x" -type f | wc -l)
  echo "   tier 1 unpack:  exit $rc in ${t}s, $files files ($(ls "$x" | tr '\n' ' '))"
  [ "$rc" = 0 ] || tail -2 "/tmp/ie-$case.log" | sed 's/^/                   /'
  pfx=$(fresh_prefix "t1-$case")
  echo "   tier 1 game:    $(starts "$pfx" "$x/app" "$case-tier1")"

  # tier 2: silent run
  pfx=$(fresh_prefix "t2-$case")
  extra=()
  [ "$case" = 04-pages ] && extra=(/COMPONENTS=game,hd /PLAYER=Tester)
  t=$(date +%s)
  # The time limit has to cover the whole prefix: stopping the "wine" launcher leaves the
  # installer itself (setup.tmp) running, and an unbounded "wineserver -w" then waits forever.
  WINEPREFIX=$pfx wine "$exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /ALLUSERS \
    "/DIR=C:\\Games\\$case" "/LOG=C:\\setup.log" "${extra[@]}" >/dev/null 2>&1 &
  sleep 3
  if WINEPREFIX=$pfx timeout "${LIMIT:-120}" wineserver -w; then wait $!; rc=$?
  else rc=hung; WINEPREFIX=$pfx wineserver -k 2>/dev/null; wait $! 2>/dev/null; fi
  t=$(( $(date +%s) - t ))
  inst="$pfx/drive_c/Games/$case"
  [ "$rc" = hung ] && echo "   tier 2 silent:  HUNG: no progress for ${LIMIT:-120}s, so everything in the sandbox was stopped" || echo "   tier 2 silent:  exit $rc in ${t}s, $(find "$inst" -type f 2>/dev/null | wc -l) files"
  if [ "$rc" != 0 ] && [ -f "$pfx/drive_c/setup.log" ]; then
    echo "                   last lines of the installer's log:"
    tr -d '\r' < "$pfx/drive_c/setup.log" | grep -iE "refuses|error|exception|couldn|abort|Rolling back|Message box" | tail -3 | cut -c25-200 | sed 's/^/                   /'
  fi
  if [ "$case" = 04-pages ]; then
    echo "   tier 2 choices: player.ini says '$(tr -d '\r' < "$inst/player.ini" 2>/dev/null | grep -i name)'," \
      "HD textures: $(ls "$inst/data/hd.pak" 2>/dev/null | wc -l), soundtrack: $(ls "$inst/music/music.pak" 2>/dev/null | wc -l)"
    echo "   tier 1 choices: HD textures: $(find "$x" -name hd.pak | wc -l), soundtrack: $(find "$x" -name music.pak | wc -l), player.ini: $(find "$x" -name player.ini | wc -l)"
  fi
  [ "$rc" = 0 ] && echo "   tier 2 game:    $(starts "$pfx" "$inst" "$case-tier2")"
done
