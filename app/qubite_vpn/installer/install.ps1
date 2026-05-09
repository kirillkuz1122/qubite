# Qubite VPN — Windows Installer (PowerShell)
# Usage: irm https://raw.githubusercontent.com/kirillkuz1122/qubite/main/app/qubite_vpn/installer/install.ps1 | iex
# Or: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
$InstallDir = "$env:ProgramFiles\QubiteVPN"
$Repo = "https://github.com/kirillkuz1122/qubite"
$Branch = "main"

Write-Host "=== Qubite VPN Installer ===" -ForegroundColor Cyan
Write-Host ""

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[!] Restarting as Administrator..." -ForegroundColor Yellow
    Start-Process powershell "-ExecutionPolicy Bypass -Command `"irm https://raw.githubusercontent.com/kirillkuz1122/qubite/$Branch/app/qubite_vpn/installer/install.ps1 | iex`"" -Verb RunAs
    exit
}

# Download release zip from GitHub
$ZipUrl = "$Repo/releases/latest/download/qubite-vpn-windows.zip"
$TmpZip = "$env:TEMP\qubite-vpn-windows.zip"

Write-Host "[1/4] Downloading Qubite VPN..." -ForegroundColor Green
try {
    Invoke-WebRequest -Uri $ZipUrl -OutFile $TmpZip -UseBasicParsing
} catch {
    # Fallback: try downloading the bundle directory from repo
    Write-Host "    Release not found. Trying repo archive..." -ForegroundColor Yellow
    $ZipUrl = "$Repo/archive/refs/heads/$Branch.zip"
    Write-Host "    [!] Pre-built Windows bundle not available."
    Write-Host "    Build on Windows: flutter build windows --release --dart-define=VPN_APP_TOKEN=..."
    Write-Host "    Then copy install.bat next to build\windows\x64\runner\Release\ and run it."
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[2/4] Installing to $InstallDir..." -ForegroundColor Green
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Expand-Archive -Path $TmpZip -DestinationPath $InstallDir -Force
Remove-Item $TmpZip -Force

Write-Host "[3/4] Creating shortcuts..." -ForegroundColor Green
$WScriptShell = New-Object -ComObject WScript.Shell

# Start Menu
$StartMenu = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Qubite VPN.lnk"
$Shortcut = $WScriptShell.CreateShortcut($StartMenu)
$Shortcut.TargetPath = "$InstallDir\qubite_vpn.exe"
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "Qubite VPN"
$Shortcut.Save()

# Desktop
$Desktop = "$env:PUBLIC\Desktop\Qubite VPN.lnk"
$Shortcut = $WScriptShell.CreateShortcut($Desktop)
$Shortcut.TargetPath = "$InstallDir\qubite_vpn.exe"
$Shortcut.WorkingDirectory = $InstallDir
$Shortcut.Description = "Qubite VPN"
$Shortcut.Save()

Write-Host "[4/4] Registering application..." -ForegroundColor Green
$UninstallKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN"
New-Item -Path $UninstallKey -Force | Out-Null
Set-ItemProperty -Path $UninstallKey -Name "DisplayName" -Value "Qubite VPN"
Set-ItemProperty -Path $UninstallKey -Name "InstallLocation" -Value $InstallDir
Set-ItemProperty -Path $UninstallKey -Name "DisplayVersion" -Value "1.0.0"
Set-ItemProperty -Path $UninstallKey -Name "Publisher" -Value "Qubite"
Set-ItemProperty -Path $UninstallKey -Name "NoModify" -Value 1 -Type DWord
Set-ItemProperty -Path $UninstallKey -Name "NoRepair" -Value 1 -Type DWord

Write-Host ""
Write-Host "=== Qubite VPN installed! ===" -ForegroundColor Cyan
Write-Host "Find 'Qubite VPN' in Start Menu or on Desktop."
Write-Host ""
Read-Host "Press Enter to exit"
