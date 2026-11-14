; The heaviest compression Inno Setup offers, with a large dictionary: slow and memory-hungry to
; unpack. 300 MB of game data squeezed into a small installer.
#define CaseName "03-ultra"
#include "common.iss"

[Setup]
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMADictionarySize=262144
LZMANumFastBytes=273

[Files]
Source: "bin\game.exe"; DestDir: "{app}"
Source: "payload\core.pak"; DestDir: "{app}\data"
Source: "payload\levels.dat"; DestDir: "{app}\data"
