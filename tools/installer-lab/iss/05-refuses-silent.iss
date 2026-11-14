; An installer that refuses to run without its screens: started silently, it quits at once.
; Only unpacking it, or a person clicking through it, gets the game out.
#define CaseName "05-refuses-silent"
#include "common.iss"

[Setup]
Compression=lzma2
SolidCompression=yes

[Files]
Source: "bin\game.exe"; DestDir: "{app}"
Source: "payload\core.pak"; DestDir: "{app}\data"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := not WizardSilent;
  if not Result then
    Log('This installer refuses to run silently.');
end;
