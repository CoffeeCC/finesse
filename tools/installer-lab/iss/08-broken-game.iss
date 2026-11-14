; Installs perfectly, but the game itself won't start (exits with code 1). Only the "does it
; start" check catches this.
#define CaseName "08-broken-game"
#include "common.iss"

[Setup]
Compression=lzma2
SolidCompression=yes

[Files]
Source: "bin\game-broken.exe"; DestDir: "{app}"; DestName: "game.exe"
Source: "payload\core.pak"; DestDir: "{app}\data"
