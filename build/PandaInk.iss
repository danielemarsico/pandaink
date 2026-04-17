; Inno Setup script for PandaInk
; Build from repo root: iscc /DMyAppVersion=1.0.0 build\PandaInk.iss
; Output: dist\PandaInk-setup.exe

#ifndef MyAppVersion
  #define MyAppVersion "dev"
#endif

[Setup]
AppName=PandaInk
AppVersion={#MyAppVersion}
AppPublisher=Daniele Marsico
AppPublisherURL=https://github.com/danielemarsico/pandaink
AppSupportURL=https://github.com/danielemarsico/pandaink/issues
AppUpdatesURL=https://github.com/danielemarsico/pandaink/releases
DefaultDirName={autopf}\PandaInk
DefaultGroupName=PandaInk
OutputDir={#SourcePath}\..\dist
OutputBaseFilename=PandaInk-setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\PandaInk.exe
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourcePath}\..\dist\PandaInk.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\PandaInk"; Filename: "{app}\PandaInk.exe"
Name: "{group}\{cm:UninstallProgram,PandaInk}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\PandaInk"; Filename: "{app}\PandaInk.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\PandaInk.exe"; Description: "{cm:LaunchProgram,PandaInk}"; Flags: nowait postinstall skipifsilent
