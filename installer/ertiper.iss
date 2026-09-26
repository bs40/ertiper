; Ertiper Flight Board installer (Inno Setup 6). Build with installer\build.ps1.
;
; Installs to C:\Program Files\Ertiper, keeps settings in C:\ProgramData\Ertiper, and:
;   1. turns on IIS (static pages) and installs URL Rewrite + ARR if missing
;   2. uses the IIS site "ertiper" (creating it on port 8081 if it doesn't exist) and copies the
;      board's pages + web.config into that site's own folder; the site's app pool is left alone
;   3. registers the "Ertiper" Windows service (bundled Node.js, run by WinSW as LocalService),
;      which IIS forwards /api requests to
;   4. opens the site's port(s) in Windows Firewall for home/work networks

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef ServicePort
  #define ServicePort "8095"
#endif
#define Root ".."
#define ServiceId "Ertiper"
#define SiteName "ertiper"
#define DefaultPort "8081"
#define FirewallRule "Ertiper Flight Board (HTTP)"

[Setup]
AppId={{8F1C2E7A-5B4D-4C3E-9A61-2E7B0C9D4F11}
AppName=Ertiper Flight Board
AppVersion={#AppVersion}
AppVerName=Ertiper Flight Board {#AppVersion}
AppPublisher=Ertiper
DefaultDirName={autopf}\Ertiper
DisableDirPage=yes
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
MinVersion=10.0
OutputDir=dist
OutputBaseFilename=ErtiperSetup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=no
UninstallDisplayName=Ertiper Flight Board

[Files]
Source: "vendor\node\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "vendor\node\LICENSE"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "vendor\WinSW.exe"; DestDir: "{app}"; DestName: "ErtiperService.exe"; Flags: ignoreversion
Source: "ErtiperService.xml"; DestDir: "{app}"; Flags: ignoreversion
Source: "diagnose.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs
; The master copy of the pages; setup copies them into the IIS site's folder.
Source: "{#Root}\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs
Source: "{#Root}\data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs
Source: "{#Root}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\README.md"; DestDir: "{app}"; Flags: ignoreversion
; Settings are only written on first install, so upgrades keep your location, airport and key.
Source: "{#Root}\config.json"; DestDir: "{commonappdata}\Ertiper"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "vendor\rewrite_amd64_en-US.msi"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "vendor\requestRouter_amd64.msi"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Dirs]
Name: "{commonappdata}\Ertiper"; Flags: uninsneveruninstall
Name: "{commonappdata}\Ertiper\logs"; Flags: uninsneveruninstall

[Icons]
; The .url files are written by the [Code] section once the site's port is known.
Name: "{autoprograms}\Ertiper Flight Board"; Filename: "{app}\Flight Board.url"
Name: "{autoprograms}\Ertiper Settings"; Filename: "{app}\Board Settings.url"
Name: "{autoprograms}\Ertiper Diagnostics"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoExit -ExecutionPolicy Bypass -File ""{app}\diagnose.ps1"""; Comment: "Check the flight board service and IIS (run as administrator)"

[UninstallDelete]
Type: files; Name: "{app}\Flight Board.url"
Type: files; Name: "{app}\Board Settings.url"

[Run]
Filename: "{code:GetSiteUrl}"; Description: "Open the flight board"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
; The IIS site, its folder and pool are yours, so uninstall leaves them in place.
Filename: "{app}\ErtiperService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{app}\ErtiperService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""{#FirewallRule}"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewallRule"

[Code]
var
  RestartNeeded: Boolean;
  Problems: String;
  SiteUrl: String;

function Run(const Exe, Params, Status: String; var Code: Integer): Boolean;
begin
  WizardForm.StatusLabel.Caption := Status;
  Log(Format('Running: "%s" %s', [Exe, Params]));
  Result := Exec(Exe, Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log(Format('  exit code %d', [Code]));
end;

procedure AddProblem(const Text: String);
begin
  Log('PROBLEM: ' + Text);
  Problems := Problems + #13#10 + '- ' + Text;
end;

{ Run a step that must succeed; 3010 means "done, restart needed". Failures are collected and shown at the end. }
function Step(const Exe, Params, Status: String): Boolean;
var
  Code: Integer;
begin
  Result := False;
  if not Run(Exe, Params, Status, Code) then
    AddProblem(Status + ' (could not start ' + Exe + ')')
  else if Code = 3010 then
  begin
    RestartNeeded := True;
    Result := True;
  end
  else if Code <> 0 then
    AddProblem(Format('%s (exit code %d)', [Status, Code]))
  else
    Result := True;
end;

{ Run a step whose failure doesn't matter (e.g. removing something that isn't there). }
procedure TryStep(const Exe, Params, Status: String);
var
  Code: Integer;
begin
  Run(Exe, Params, Status, Code);
end;

function Sys(const Name: String): String;
begin
  Result := ExpandConstant('{sys}\' + Name);
end;

function AppCmd: String;
begin
  Result := Sys('inetsrv\appcmd.exe');
end;

{ Run appcmd and return its trimmed output, or '' if it failed. }
function AppCmdOutput(const Params: String): String;
var
  OutFile: String;
  Code: Integer;
  Text: AnsiString;
begin
  Result := '';
  OutFile := ExpandConstant('{tmp}\appcmd-output.txt');
  DeleteFile(OutFile);
  if Exec(ExpandConstant('{cmd}'), '/c ""' + AppCmd + '" ' + Params + ' > "' + OutFile + '""', '', SW_HIDE,
    ewWaitUntilTerminated, Code) and (Code = 0) and LoadStringFromFile(OutFile, Text) then
    Result := Trim(String(Text));
  Log(Format('appcmd %s -> "%s" (exit code %d)', [Params, Result, Code]));
end;

{ Expand %VARIABLES% such as %SystemDrive% in IIS paths. }
function ExpandEnv(const S: String): String;
var
  P, Q: Integer;
begin
  Result := S;
  P := Pos('%', Result);
  while P > 0 do
  begin
    Q := Pos('%', Copy(Result, P + 1, Length(Result)));
    if Q = 0 then Break;
    Result := Copy(Result, 1, P - 1) + GetEnv(Copy(Result, P + 1, Q - 1)) + Copy(Result, P + Q + 1, Length(Result));
    P := Pos('%', Result);
  end;
end;

{ Ports from IIS bindings such as "http/*:8081:,https/*:443:host" -> "8081,443". }
function PortsFromBindings(const Bindings: String): String;
var
  Rest, Part: String;
  P: Integer;
begin
  Result := '';
  Rest := Bindings + ',';
  while Rest <> '' do
  begin
    P := Pos(',', Rest);
    Part := Copy(Rest, 1, P - 1);
    Rest := Copy(Rest, P + 1, Length(Rest));
    P := Pos(':', Part);
    if P > 0 then
    begin
      Part := Copy(Part, P + 1, Length(Part));
      P := Pos(':', Part);
      if P > 0 then Part := Copy(Part, 1, P - 1);
      if (Part <> '') and (Pos(',' + Part + ',', ',' + Result + ',') = 0) then
      begin
        if Result <> '' then Result := Result + ',';
        Result := Result + Part;
      end;
    end;
  end;
end;

function GetSiteUrl(Param: String): String;
begin
  Result := SiteUrl;
end;

procedure StopOldService;
var
  Svc: String;
begin
  Svc := ExpandConstant('{app}\ErtiperService.exe');
  if FileExists(Svc) then
  begin
    TryStep(Svc, 'stop', 'Stopping the flight board service...');
    TryStep(Svc, 'uninstall', 'Removing the old service registration...');
  end;
end;

procedure InstallIisAndAddOns;
var
  LogDir: String;
begin
  LogDir := ExpandConstant('{commonappdata}\Ertiper\logs');

  Step(Sys('dism.exe'),
    '/Online /Enable-Feature /FeatureName:IIS-WebServerRole /FeatureName:IIS-WebServer ' +
    '/FeatureName:IIS-CommonHttpFeatures /FeatureName:IIS-StaticContent /FeatureName:IIS-DefaultDocument ' +
    '/FeatureName:IIS-HttpErrors /FeatureName:IIS-HealthAndDiagnostics /FeatureName:IIS-HttpLogging ' +
    '/FeatureName:IIS-Security /FeatureName:IIS-RequestFiltering /FeatureName:IIS-Performance ' +
    '/FeatureName:IIS-HttpCompressionStatic /FeatureName:IIS-WebServerManagementTools ' +
    '/FeatureName:IIS-ManagementConsole /All /NoRestart /Quiet',
    'Turning on IIS (this can take a few minutes)...');

  if not FileExists(Sys('inetsrv\rewrite.dll')) then
    Step(Sys('msiexec.exe'),
      '/i "' + ExpandConstant('{tmp}\rewrite_amd64_en-US.msi') + '" /qn /norestart /l*v "' + LogDir + '\install-urlrewrite.log"',
      'Installing IIS URL Rewrite...');

  if not FileExists(ExpandConstant('{commonpf64}\IIS\Application Request Routing\requestRouter.dll')) then
    Step(Sys('msiexec.exe'),
      '/i "' + ExpandConstant('{tmp}\requestRouter_amd64.msi') + '" /qn /norestart /l*v "' + LogDir + '\install-arr.log"',
      'Installing IIS Application Request Routing...');

  { ARR's proxy is off until switched on; the site's web.config uses it to reach the service. }
  Step(AppCmd, 'set config -section:system.webServer/proxy /enabled:"True" /commit:apphost',
    'Turning on the IIS proxy...');
end;

{ Make sure site "ertiper" exists and return its folder ('' on failure). }
function PrepareSite: String;
var
  Folder: String;
  Code: Integer;
begin
  Result := '';
  if AppCmdOutput('list site /name:{#SiteName}') = '' then
  begin
    { No site yet (a fresh PC): create one like VAN's, on port {#DefaultPort} with a no-.NET pool. }
    Folder := ExpandConstant('{sd}\inetpub\{#SiteName}');
    ForceDirectories(Folder);
    if not Run(AppCmd, 'list apppool /name:Ertiper', 'Checking the IIS application pool...', Code) or (Code <> 0) then
      Step(AppCmd, 'add apppool /name:Ertiper /managedRuntimeVersion:""', 'Creating the IIS application pool...');
    if not Step(AppCmd, 'add site /name:{#SiteName} /bindings:http/*:{#DefaultPort}: /physicalPath:"' + Folder + '"',
      'Creating the IIS site "{#SiteName}" on port {#DefaultPort}...') then Exit;
    Step(AppCmd, 'set app "{#SiteName}/" /applicationPool:Ertiper', 'Assigning the application pool...');
  end;

  Result := ExpandEnv(AppCmdOutput('list vdir "{#SiteName}/" /text:physicalPath'));
  if Result = '' then
    AddProblem('Could not find the folder of IIS site "{#SiteName}"')
  else if not ForceDirectories(Result) then
  begin
    AddProblem('Could not create the site folder ' + Result);
    Result := '';
  end;
end;

{ Copy the pages (index.html, scripts, styles, web.config) into the site's folder. }
procedure CopyPages(const Dest: String);
var
  FR: TFindRec;
  Src: String;
begin
  WizardForm.StatusLabel.Caption := 'Copying the pages to ' + Dest + ' ...';
  Src := ExpandConstant('{app}\public\');
  if FindFirst(Src + '*', FR) then
  try
    repeat
      if FR.Attributes and FILE_ATTRIBUTE_DIRECTORY = 0 then
      begin
        if CopyFile(Src + FR.Name, AddBackslash(Dest) + FR.Name, False) then
          Log('Copied ' + FR.Name + ' to ' + Dest)
        else
          AddProblem('Could not copy ' + FR.Name + ' to ' + Dest);
      end;
    until not FindNext(FR);
  finally
    FindClose(FR);
  end;
end;

procedure SetUpSite;
var
  Folder, Ports, FirstPort: String;
begin
  { Tidy up after version 1.0.0, which tried to add /ertiper under Default Web Site. }
  TryStep(AppCmd, 'delete app "Default Web Site/ertiper"', 'Tidying up the previous version...');

  Folder := PrepareSite;
  if Folder <> '' then CopyPages(Folder);
  TryStep(AppCmd, 'start site /site.name:{#SiteName}', 'Starting the IIS site...');

  Ports := PortsFromBindings(AppCmdOutput('list site /name:{#SiteName} /text:bindings'));
  if Ports = '' then Ports := '{#DefaultPort}';
  FirstPort := Ports;
  if Pos(',', FirstPort) > 0 then FirstPort := Copy(FirstPort, 1, Pos(',', FirstPort) - 1);
  SiteUrl := 'http://localhost:' + FirstPort + '/';

  TryStep(Sys('netsh.exe'), 'advfirewall firewall delete rule name="{#FirewallRule}"', 'Updating Windows Firewall...');
  Step(Sys('netsh.exe'), 'advfirewall firewall add rule name="{#FirewallRule}" dir=in action=allow protocol=TCP localport=' +
    Ports + ' profile=private,domain', 'Allowing the board through Windows Firewall (port ' + Ports + ')...');

  SaveStringToFile(ExpandConstant('{app}\Flight Board.url'), '[InternetShortcut]' + #13#10 + 'URL=' + SiteUrl + #13#10, False);
  SaveStringToFile(ExpandConstant('{app}\Board Settings.url'), '[InternetShortcut]' + #13#10 + 'URL=' + SiteUrl + 'settings.html' + #13#10, False);
end;

procedure SetUpService;
var
  Svc: String;
begin
  Svc := ExpandConstant('{app}\ErtiperService.exe');
  Step(Svc, 'install', 'Registering the flight board service...');
  { Run with the low-privilege LocalService account, allowed to write its settings and logs only. }
  Step(Sys('sc.exe'), 'config {#ServiceId} obj= "NT AUTHORITY\LocalService" password= ""', 'Setting the service account...');
  Step(Sys('icacls.exe'), '"' + ExpandConstant('{commonappdata}\Ertiper') + '" /grant *S-1-5-19:(OI)(CI)M /T /Q',
    'Allowing the service to save settings...');
  Step(Svc, 'start', 'Starting the flight board service...');
end;

function PortInUse(const Port: String): Boolean;
var
  Code: Integer;
begin
  Result := Exec(Sys('WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "if (Get-NetTCPConnection -LocalPort ' + Port +
    ' -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"',
    '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 1);
  Log(Format('Port %s in use: %d', [Port, Ord(Result)]));
end;

{ Before anything is changed: stop our own service, then make sure nothing else has the service port. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  StopOldService;
  if PortInUse('{#ServicePort}') then
    Result := 'Port {#ServicePort} is already being used by another program on this PC, and the flight board ' +
      'service needs it.' + #13#10#13#10 + 'Nothing has been changed. To see which program is using it, run this ' +
      'in a command prompt:' + #13#10 + '    netstat -abno | findstr :{#ServicePort}';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    InstallIisAndAddOns;
    SetUpSite;
    SetUpService;
    if Problems <> '' then
      SuppressibleMsgBox('Setup finished, but some steps did not complete:' + #13#10 + Problems + #13#10#13#10 +
        'Details are in the setup log (%TEMP%\Setup Log *.txt) and C:\ProgramData\Ertiper\logs.',
        mbError, MB_OK, IDOK);
  end;
end;

function NeedRestart: Boolean;
begin
  Result := RestartNeeded;
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  RestartNeeded := False;
  Problems := '';
  SiteUrl := 'http://localhost:{#DefaultPort}/';
end;
