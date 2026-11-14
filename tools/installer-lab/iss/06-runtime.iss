; Runs a bundled runtime installer during setup (like Visual C++ or DirectX). The game won't
; start without that runtime, so unpacking alone isn't enough: the files are all there, but the
; game exits with code 3.
#define CaseName "06-runtime"
#include "common.iss"

[Setup]
Compression=lzma2
SolidCompression=yes

[Files]
Source: "bin\game-rt.exe"; DestDir: "{app}"; DestName: "game.exe"
Source: "payload\core.pak"; DestDir: "{app}\data"
Source: "bin\redist.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Run]
Filename: "{tmp}\redist.exe"; Parameters: "/quiet"; StatusMsg: "Installing the game runtime..."; Flags: waituntilterminated
