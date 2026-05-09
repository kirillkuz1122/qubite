# Windows Build & Installer

## Prerequisites

1. Windows 10/11 with Visual Studio 2022 (Desktop C++ workload)
2. Flutter SDK (same version as project)
3. [Inno Setup 6](https://jrsoftware.org/isdl.php)
4. [sing-box](https://github.com/SagerNet/sing-box/releases) — download `sing-box-*-windows-amd64.zip`

## Build Steps

```powershell
# 1. Build Flutter app
flutter build windows --release --dart-define=VPN_APP_TOKEN=502d0b12581dccf353976a22ba0bea07796cf0d9d0464db45bfe386b8fc1349d

# 2. Place sing-box.exe next to setup.iss
copy path\to\sing-box.exe installer\windows\

# 3. Compile installer (GUI or CLI)
iscc installer\windows\setup.iss
```

## Output

`installer/windows/output/QubiteVPN_Setup_1.0.0.exe`

This creates a standard Windows installer that:
- Installs to `C:\Program Files\QubiteVPN\`
- Creates Start Menu shortcut
- Optional desktop icon
- Optional autostart
- Adds uninstaller to Programs & Features
