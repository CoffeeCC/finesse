; Pages that want answers: a license to accept, components to pick (full / minimal / custom,
; with HD textures and a soundtrack optional), and a custom page that won't continue without a
; player name. The name ends up in player.ini.
#define CaseName "04-pages"
#include "common.iss"

[Setup]
Compression=lzma2
SolidCompression=yes
LicenseFile=license.txt

[Types]
Name: "full"; Description: "Everything"
Name: "minimal"; Description: "Just the game"
Name: "custom"; Description: "Let me choose"; Flags: iscustom

[Components]
Name: "game"; Description: "The game"; Types: full minimal custom; Flags: fixed
Name: "hd"; Description: "HD textures"; Types: full
Name: "music"; Description: "Soundtrack"; Types: full

[Files]
Source: "bin\game.exe"; DestDir: "{app}"; Components: game
Source: "payload\core.pak"; DestDir: "{app}\data"; Components: game
Source: "payload\hd.pak"; DestDir: "{app}\data"; Components: hd
Source: "payload\music.pak"; DestDir: "{app}\music"; Components: music

[INI]
Filename: "{app}\player.ini"; Section: "player"; Key: "name"; String: "{code:PlayerName}"

[Code]
var
  NamePage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  NamePage := CreateInputQueryPage(wpSelectComponents, 'Player', 'Who is playing?',
    'Type a player name. Setup won''t continue without one.');
  NamePage.Add('Name:', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = NamePage.ID) and (Trim(NamePage.Values[0]) = '') then
  begin
    MsgBox('A player name is required.', mbError, MB_OK);
    Result := False;
  end;
end;

function PlayerName(Param: String): String;
begin
  Result := Trim(NamePage.Values[0]);
  if Result = '' then
    Result := ExpandConstant('{param:PLAYER|Player}');
end;
