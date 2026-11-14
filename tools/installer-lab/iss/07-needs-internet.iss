; Downloads extra content during setup. In the sandbox (no network) the download fails, and the
; installer must stop with a clear error, not hang.
#define CaseName "07-needs-internet"
#include "common.iss"

[Setup]
Compression=lzma2
SolidCompression=yes

[Files]
Source: "bin\game.exe"; DestDir: "{app}"
Source: "payload\core.pak"; DestDir: "{app}\data"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  try
    DownloadTemporaryFile('https://downloads.example.com/extra-content.pak', 'extra-content.pak', '', nil);
  except
    Result := 'Couldn''t download the extra content: ' + GetExceptionMessage;
  end;
end;
