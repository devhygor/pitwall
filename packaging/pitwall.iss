; Instalador do Pitwall (Inno Setup 6). Gerado pelo GitHub Actions (.github/workflows/release.yml).
; Instala só para o usuário atual: não pede administrador.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{B1716809-44F1-4A9C-B4D9-BA2D0F29110A}
AppName=Pitwall
AppVersion={#AppVersion}
AppVerName=Pitwall {#AppVersion}
AppPublisher=Pitwall
AppPublisherURL=https://pitwall.hygor.com.br/
AppSupportURL=https://github.com/devhygor/pitwall
DefaultDirName={localappdata}\Programs\Pitwall
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Pitwall-Setup
SetupIconFile=pitwall.ico
UninstallDisplayIcon={app}\Pitwall.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"
Name: "autostart"; Description: "Iniciar com o Windows, em segundo plano (grava sozinho quando você entra na pista)"; GroupDescription: "Gravação:"

[Files]
Source: "..\dist\Pitwall\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Pitwall"; Filename: "{app}\Pitwall.exe"
Name: "{userdesktop}\Pitwall"; Filename: "{app}\Pitwall.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Pitwall"; \
  ValueData: """{app}\Pitwall.exe"" --background"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\Pitwall.exe"; Description: "Abrir o Pitwall agora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM Pitwall.exe /F"; Flags: runhidden; RunOnceId: "StopPitwall"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
