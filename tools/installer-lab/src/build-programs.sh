#!/bin/bash
# Builds the stand-in game (three variants) and the stand-in runtime installer into ../iss/bin.
set -eu
cd "$(dirname "$0")"
mkdir -p ../iss/bin
CC="x86_64-w64-mingw32-gcc -O2 -s -mwindows"
$CC -o ../iss/bin/game.exe game.c
$CC -DNEEDS_RUNTIME -o ../iss/bin/game-rt.exe game.c
$CC -DBROKEN -o ../iss/bin/game-broken.exe game.c
$CC -o ../iss/bin/redist.exe redist.c
ls -la ../iss/bin
