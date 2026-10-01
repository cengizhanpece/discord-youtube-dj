; Inno Setup script — builds DiscordYouTubeDJ-Setup-<version>.exe from installer/build/.
; Run installer/build.mjs first, then:  iscc /DAppVersion=1.0.0 installer\setup.iss

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#define AppName "Discord YouTube DJ"
#define AppExe "DiscordYouTubeDJ.exe"
#define Launch "--background"

[Setup]
AppId={{6B0E7C1F-3D7A-4C55-9C1E-2F0D5A9B8E41}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Discord YouTube DJ contributors
AppPublisherURL=https://github.com/YOUR_GITHUB_USERNAME/discord-youtube-dj
DefaultDirName={localappdata}\Programs\DiscordYouTubeDJ
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
; Per-user install: no admin prompt.
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=DiscordYouTubeDJ-Setup-{#AppVersion}
SetupIconFile=build\icon.ico
UninstallDisplayIcon={app}\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"

[CustomMessages]
en.AutoStart=Start automatically when I sign in to Windows
tr.AutoStart=Windows'a giriş yaptığımda otomatik başlat
en.OpenDashboard=Open {#AppName}
tr.OpenDashboard={#AppName} uygulamasını aç

[Tasks]
Name: "autostart"; Description: "{cm:AutoStart}"

[Files]
Source: "build\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Remove old sources/dependencies on upgrade so deleted files don't linger.
Type: filesandordirs; Name: "{app}\app"

[Icons]
; Start menu: starts the bot if needed and opens the dashboard.
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; Parameters: """{app}\app\src\main.js"" {#Launch} --open"; IconFilename: "{app}\icon.ico"; Flags: runminimized
; Login: start silently in the background.
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#AppExe}"; Parameters: """{app}\app\src\main.js"" {#Launch}"; IconFilename: "{app}\icon.ico"; Flags: runminimized; Tasks: autostart

[Run]
Filename: "{app}\{#AppExe}"; Parameters: """{app}\app\src\main.js"" {#Launch} --open"; Description: "{cm:OpenDashboard}"; Flags: postinstall nowait runhidden

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppExe}"; Flags: runhidden; RunOnceId: "StopBot"

[Code]
// Stop a running copy before upgrading, otherwise its files are locked.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
