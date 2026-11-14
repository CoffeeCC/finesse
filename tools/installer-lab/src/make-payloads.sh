#!/bin/bash
# Test data for the installers: small game data, optional extras, incompressible filler (for the
# installer split across files) and highly compressible data (for the heaviest compression).
set -eu
cd "$(dirname "$0")/../iss"
mkdir -p payload
echo "core game data" > payload/core.pak
[ -f payload/hd.pak ] || head -c 20000000 /dev/urandom > payload/hd.pak
[ -f payload/music.pak ] || head -c 8000000 /dev/urandom > payload/music.pak
for i in 1 2 3; do [ -f payload/filler-$i.bin ] || head -c 120000000 /dev/urandom > payload/filler-$i.bin; done
[ -f payload/levels.dat ] || seq 1 40000000 | awk '{print "level row " $1 " tile " ($1*7)%113}' | head -c 300000000 > payload/levels.dat
printf 'TEST LICENSE\r\n\r\nThis is a test installer for Finesse. Accept it to continue.\r\n' > license.txt
ls -la payload
