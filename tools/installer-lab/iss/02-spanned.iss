; A big installer split across files: setup.exe plus setup-1.bin, setup-2.bin… (how large
; store installers are shipped). The data is random, so it barely compresses.
#define CaseName "02-spanned"
#include "common.iss"

[Setup]
Compression=lzma2/fast
SolidCompression=no
DiskSpanning=yes
DiskSliceSize=104857600

[Files]
Source: "bin\game.exe"; DestDir: "{app}"
Source: "payload\core.pak"; DestDir: "{app}\data"
Source: "payload\filler-*.bin"; DestDir: "{app}\data"
