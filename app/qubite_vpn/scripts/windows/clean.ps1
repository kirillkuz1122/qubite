#Requires -Version 5.1
# Qubite VPN - Uninstall dependencies installed by loader
# Run as Administrator

param([switch]$All)

$ErrorActionPreference = "Continue"

function Write-Step($msg) { Write-Host "" ; Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "    [ERR] $msg" -ForegroundColor Red }
function Write-Skip($msg) { Write-Host "    [SKIP] $msg" -ForegroundColor Yellow }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Err "Run as Administrator."; exit 1 }

Write-Host ""
Write-Host "============================================" -ForegroundColor Red
Write-Host "  Qubite VPN - Cleanup                     " -ForegroundColor Red
Write-Host "============================================" -ForegroundColor Red

# --- 1. sing-box binary ---
Write-Step "sing-box binary"
$projectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$singboxExe = Join-Path $projectDir "core_build\windows\sing-box.exe"
if (Test-Path $singboxExe) {
    Remove-Item $singboxExe -Force
    Write-Ok "Deleted $singboxExe"
}
else { Write-Skip "Not found" }

# --- 2. Flutter build artifacts ---
Write-Step "Flutter build cache"
$buildDir = Join-Path $projectDir "build"
if (Test-Path $buildDir) {
    Remove-Item $buildDir -Recurse -Force
    Write-Ok "Deleted build/"
}
else { Write-Skip "No build dir" }

$dartTool = Join-Path $projectDir ".dart_tool"
if (Test-Path $dartTool) {
    Remove-Item $dartTool -Recurse -Force
    Write-Ok "Deleted .dart_tool/"
}

# --- 3. Flutter SDK ---
Write-Step "Flutter SDK"
$flutterDir = Join-Path $env:USERPROFILE "flutter"
if (Test-Path $flutterDir) {
    Write-Host "    Removing $flutterDir (this takes a minute)..." -ForegroundColor Yellow
    Remove-Item $flutterDir -Recurse -Force
    # Remove from PATH
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $cleaned = ($userPath -split ";" | Where-Object { $_ -notlike "*flutter*" }) -join ";"
    [System.Environment]::SetEnvironmentVariable("Path", $cleaned, "User")
    Write-Ok "Flutter SDK removed"
}
else { Write-Skip "Not found at $flutterDir" }

# --- 4. Choco packages ---
Write-Step "Choco packages (Go, CMake)"
if (Get-Command choco -ErrorAction SilentlyContinue) {
    $pkgs = @("golang", "cmake")
    foreach ($pkg in $pkgs) {
        $installed = choco list --local-only $pkg 2>$null | Select-String $pkg
        if ($installed) {
            choco uninstall $pkg -y --no-progress 2>&1 | Out-Null
            Write-Ok "Uninstalled $pkg"
        }
        else { Write-Skip "$pkg not installed" }
    }
}
else { Write-Skip "Chocolatey not found" }

# --- 5. VS ATL component (optional) ---
if ($All) {
    Write-Step "VS Build Tools ATL component"
    $pf86 = ${env:ProgramFiles(x86)}
    if ($pf86) {
        $installer = Join-Path $pf86 "Microsoft Visual Studio\Installer\vs_installer.exe"
        if (Test-Path $installer) {
            & $installer modify --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" --remove Microsoft.VisualStudio.Component.VC.ATL --quiet --norestart 2>&1 | Out-Null
            Write-Ok "ATL component removed"
        }
    }

    Write-Step "Chocolatey itself"
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        $chocoDir = $env:ChocolateyInstall
        if ($chocoDir -and (Test-Path $chocoDir)) {
            Remove-Item $chocoDir -Recurse -Force -ErrorAction SilentlyContinue
            [System.Environment]::SetEnvironmentVariable("ChocolateyInstall", $null, "Machine")
            $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
            $cleaned = ($machinePath -split ";" | Where-Object { $_ -notlike "*chocolatey*" }) -join ";"
            [System.Environment]::SetEnvironmentVariable("Path", $cleaned, "Machine")
            Write-Ok "Chocolatey removed"
        }
    }
    else { Write-Skip "Not found" }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Cleanup done. Restart terminal.           " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
if (-not $All) {
    Write-Host "  Note: Chocolatey and VS Build Tools kept." -ForegroundColor Gray
    Write-Host "  Use -All flag to remove everything." -ForegroundColor Gray
    Write-Host ""
}
