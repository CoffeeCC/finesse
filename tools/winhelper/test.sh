#!/bin/bash
# Runs winhelper against a stand-in message box and a stand-in game window, under Wine on a
# virtual screen. Needs: wine (wine64), Xvfb, and `make` done here. Prints PASS or what differed.
set -u
cd "$(dirname "$0")"
WINE=${WINE:-$(command -v wine64 || command -v wine || echo /usr/lib/wine/wine64)}
export WINEPREFIX=${WINEPREFIX:-$(mktemp -d)/prefix} WINEDEBUG=-all DISPLAY=:97
Xvfb :97 -screen 0 1280x720x24 >/dev/null 2>&1 &
XVFB=$!
trap 'kill $XVFB 2>/dev/null; /usr/lib/wine/wineserver -k 2>/dev/null || wineserver -k 2>/dev/null' EXIT
sleep 1
"$WINE" wineboot -i >/dev/null 2>&1
fail=0
check() { if echo "$2" | grep -q "$3"; then echo "  ok   $1"; else echo "  FAIL $1: wanted /$3/ in: $2"; fail=1; fi; }

# 1. An error box: listed as a dialog with its words and buttons; pressing OK closes it with 1.
"$WINE" testwin.exe box & BOX=$!
sleep 4
list=$("$WINE" winhelper.exe list)
check "the box is listed as a dialog" "$list" '"class":"#32770"'
check "its title"                     "$list" '"title":"Setup Error"'
check "its words"                     "$list" 'Not enough disk space'
check "its buttons"                   "$list" '"buttons":\["OK","Cancel"\]'
check "nothing to fill in"            "$list" '"wantsInput":false'
hwnd=$(echo "$list" | grep '"Setup Error"' | sed -E 's/.*"hwnd":([0-9]+).*/\1/')
check "a button that isn't there"     "$("$WINE" winhelper.exe click "$hwnd" "Install")" 'no such button'
check "pressing OK"                   "$("$WINE" winhelper.exe click "$hwnd" "&OK")" '"ok":true'
wait $BOX; check "the box closed with OK" "exit $?" 'exit 1$'

# 2. A game window: listed with its own class (not a dialog), and the picture isn't blank.
"$WINE" testwin.exe game & GAME=$!
sleep 4
list=$("$WINE" winhelper.exe list)
check "the game window is listed"     "$list" '"class":"StandInGame"'
hwnd=$(echo "$list" | grep '"StandInGame"' | sed -E 's/.*"hwnd":([0-9]+).*/\1/')
shot=$("$WINE" winhelper.exe shot shot.bmp "$hwnd")
check "a picture of it"               "$shot" '"ok":true,"blank":false'
check "the file is a bitmap"          "$(head -c 2 shot.bmp 2>/dev/null)" '^BM$'
kill $GAME 2>/dev/null; "$WINE" taskkill /f /im testwin.exe >/dev/null 2>&1
sleep 1
# 3. With nothing on it, the screen is blank.
check "an empty screen is blank"      "$("$WINE" winhelper.exe shot empty.bmp)" '"blank":true'
rm -f shot.bmp empty.bmp
[ $fail = 0 ] && echo PASS || { echo FAILED; exit 1; }
