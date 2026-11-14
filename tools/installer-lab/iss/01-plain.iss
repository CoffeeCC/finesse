; Baseline: an ordinary installer with the usual pages and nothing unusual.
#define CaseName "01-plain"
#include "common.iss"

[Setup]
Compression=lzma2
SolidCompression=yes

[Files]
Source: "bin\game.exe"; DestDir: "{app}"
Source: "payload\core.pak"; DestDir: "{app}\data"
