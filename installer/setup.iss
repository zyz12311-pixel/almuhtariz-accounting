[Setup]
AppId=AlmuhtarizAccounting
AppName=Almuhtariz Accounting
AppVersion=0.10.0-dev
DefaultDirName={localappdata}\Programs\AlmuhtarizAccounting
DefaultGroupName=Almuhtariz Accounting
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Al-Muhtariz-Accounting-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
[Files]
Source: "..\installer-stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Almuhtariz Accounting"; Filename: "{app}\start.cmd"; WorkingDir: "{app}"
Name: "{userdesktop}\Almuhtariz Accounting"; Filename: "{app}\start.cmd"; WorkingDir: "{app}"
