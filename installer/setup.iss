; Inno Setup script — builds DiscordYouTubeDJ-Setup-<version>.exe from installer/build/.
; Run installer/build.mjs first, then:  iscc /DAppVersion=1.0.0 installer\setup.iss
; Saved as UTF-8 with BOM so Turkish texts render correctly.

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
AppPublisherURL=https://github.com/cengizhanpece/discord-youtube-dj
AppSupportURL=https://github.com/cengizhanpece/discord-youtube-dj/issues
AppUpdatesURL=https://github.com/cengizhanpece/discord-youtube-dj/releases/latest
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
UninstallDisplayName={#AppName}
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
en.DeleteData=Also delete your settings?%n%nThis removes your Discord bot token, the selected channel, logs and the downloaded yt-dlp from:%n%1%n%nChoose No if you plan to reinstall and want to keep your setup.
tr.DeleteData=Ayarların da silinsin mi?%n%nDiscord bot token'ın, seçili kanal, loglar ve indirilen yt-dlp şu klasörden silinir:%n%1%n%nTekrar kurmayı düşünüyorsan ve ayarların kalsın istiyorsan Hayır'ı seç.
en.ManualSteps={#AppName} was removed. A few things can only be removed by you:%n%n• Browser extension: open chrome://extensions (or edge://extensions) and click Remove on "Discord YouTube DJ". Then you can delete its folder.%n%n• Discord bot: it stays in your servers. To delete it completely, open discord.com/developers/applications, select your app and click Delete App.%n%n• AI assistant (MCP): run "claude mcp remove discord-music", or remove "discord-music" from claude_desktop_config.json.
tr.ManualSteps={#AppName} kaldırıldı. Bazı şeyleri sadece sen kaldırabilirsin:%n%n• Tarayıcı eklentisi: chrome://extensions (ya da edge://extensions) adresini aç ve "Discord YouTube DJ" üzerinde Kaldır'a tıkla. Sonra klasörünü silebilirsin.%n%n• Discord botu: sunucularında kalmaya devam eder. Tamamen silmek için discord.com/developers/applications adresinde uygulamanı seçip Delete App'e tıkla.%n%n• Yapay zeka asistanı (MCP): "claude mcp remove discord-music" komutunu çalıştır ya da claude_desktop_config.json içinden "discord-music" kaydını sil.

[Tasks]
Name: "autostart"; Description: "{cm:AutoStart}"

[Files]
Source: "build\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; Upgrades: remove old sources/dependencies so deleted files don't linger.
Type: filesandordirs; Name: "{app}\app"
; Re-created below only if "start automatically" is still ticked.
Type: files; Name: "{userstartup}\{#AppName}.lnk"

[Icons]
; Start menu: starts the bot if needed and opens the dashboard.
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; Parameters: """{app}\app\src\main.js"" {#Launch} --open"; IconFilename: "{app}\icon.ico"; Flags: runminimized
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"; IconFilename: "{app}\icon.ico"
; Login: start silently in the background.
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#AppExe}"; Parameters: """{app}\app\src\main.js"" {#Launch}"; IconFilename: "{app}\icon.ico"; Flags: runminimized; Tasks: autostart

[Run]
Filename: "{app}\{#AppExe}"; Parameters: """{app}\app\src\main.js"" {#Launch} --open"; Description: "{cm:OpenDashboard}"; Flags: postinstall nowait runhidden

[UninstallRun]
; /T also stops yt-dlp child processes, otherwise the data folder can't be deleted.
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM {#AppExe}"; Flags: runhidden; RunOnceId: "StopBot"

[Code]
// Stop a running copy (and its yt-dlp children) before upgrading, otherwise files are locked.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

// ---------------------------------------------------------------------------
// Uninstall: optionally delete user data, then list what must be removed by hand.
// ---------------------------------------------------------------------------
var
  DeleteUserData: Boolean;

function DataDir(): String;
begin
  Result := ExpandConstant('{userappdata}\discord-youtube-dj');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  case CurUninstallStep of
    usUninstall:
      // Ask before anything is removed. Silent uninstalls keep the data.
      DeleteUserData := DirExists(DataDir()) and
        (SuppressibleMsgBox(FmtMessage(CustomMessage('DeleteData'), [DataDir()]),
          mbConfirmation, MB_YESNO, IDNO) = IDYES);
    usPostUninstall:
      begin
        if DeleteUserData then
          DelTree(DataDir(), True, True, True);
        if not UninstallSilent() then
          MsgBox(FmtMessage(CustomMessage('ManualSteps'), []), mbInformation, MB_OK);
      end;
  end;
end;
