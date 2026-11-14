; Shared by every test installer. Each case defines CaseName before including this.
[Setup]
AppName=Finesse Test {#CaseName}
AppVersion=1.0
AppPublisher=Finesse test installers
DefaultDirName={autopf}\FinesseTest\{#CaseName}
DisableProgramGroupPage=yes
OutputDir=..\out\{#CaseName}
OutputBaseFilename=setup
WizardStyle=modern
