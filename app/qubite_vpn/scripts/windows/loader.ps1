#Requires -Version 5.1
# Qubite VPN - Windows Loader
# Downloads and installs all dependencies needed to build and run the app.
# Run as Administrator.
#
# Usage:
#   .\loader.ps1              # install everything for Windows build
#   .\loader.ps1 -SkipVS      # skip VS Build Tools (if already have it)
#   .\loader.ps1 -Force       # re-download everything

param(
    [switch]$SkipVS,
    [switch]$Force
)

$ErrorActionPreference = "Continue"

function Write-Step($msg) { Write-Host "" ; Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Skip($msg) { Write-Host "    [SKIP] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "    [ERR] $msg" -ForegroundColor Red }

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# --- Admin check ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Err "Run as Administrator."; exit 1 }

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$projectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  Qubite VPN - Loader (Windows)            " -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  Project: $projectDir"

# =====================================================================
# 1. CHOCOLATEY
# =====================================================================
Write-Step "1/6 Chocolatey"
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    Refresh-Path
}
if (Get-Command choco -ErrorAction SilentlyContinue) { Write-Ok "choco ready" }
else { Write-Err "choco install failed"; exit 1 }

# =====================================================================
# 2. GIT + CMAKE
# =====================================================================
Write-Step "2/6 Git + CMake"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    choco install git -y --no-progress 2>&1 | Out-Null
    Refresh-Path
}
if (Get-Command git -ErrorAction SilentlyContinue) { Write-Ok "git $(git --version 2>$null)" }
else { Write-Err "git not found" }

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    choco install cmake --installargs "ADD_CMAKE_TO_PATH=System" -y --no-progress 2>&1 | Out-Null
    Refresh-Path
}
if (Get-Command cmake -ErrorAction SilentlyContinue) { Write-Ok "cmake" }
else { Write-Err "cmake not found" }

# =====================================================================
# 3. VS BUILD TOOLS + ATL (background)
# =====================================================================
$vsJob = $null
if (-not $SkipVS) {
    Write-Step "3/6 Visual Studio Build Tools (background)"

    $hasCpp = $false
    $pf86 = ${env:ProgramFiles(x86)}
    if ($pf86) {
        $vsWhere = Join-Path $pf86 "Microsoft Visual Studio\Installer\vswhere.exe"
        if (Test-Path $vsWhere) {
            $r = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
            if ($r) { $hasCpp = $true }
        }
    }

    if (-not $hasCpp) {
        Write-Host "    Installing C++ build tools + ATL (background, 10-20 min)..." -ForegroundColor Yellow
        $vsJob = Start-Job -ScriptBlock {
            choco install visualstudio2022buildtools -y --no-progress 2>&1 | Out-Null
            choco install visualstudio2022-workload-vctools -y --no-progress 2>&1 | Out-Null
            $inst = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vs_installer.exe"
            if (Test-Path $inst) {
                & $inst modify --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" --add Microsoft.VisualStudio.Component.VC.ATL --quiet --norestart 2>&1 | Out-Null
            }
        }
    }
    else {
        Write-Ok "VS C++ already installed"
    }
}
else {
    Write-Step "3/6 Visual Studio Build Tools"
    Write-Skip "Skipped (-SkipVS)"
}

# =====================================================================
# 4. FLUTTER SDK (while VS installs in background)
# =====================================================================
Write-Step "4/6 Flutter SDK"

$flutterDir = Join-Path $env:USERPROFILE "flutter"
$flutterBin = Join-Path $flutterDir "bin\flutter.bat"

if ((Get-Command flutter -ErrorAction SilentlyContinue) -and (-not $Force)) {
    Write-Ok "Flutter already in PATH"
}
elseif ((Test-Path $flutterBin) -and (-not $Force)) {
    $env:Path += ";$(Join-Path $flutterDir 'bin')"
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*flutter*bin*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$(Join-Path $flutterDir 'bin')", "User")
    }
    Write-Ok "Flutter found, added to PATH"
}
else {
    if (Test-Path $flutterDir) {
        Write-Host "    Removing old Flutter SDK..." -ForegroundColor Yellow
        Remove-Item $flutterDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "    Downloading Flutter SDK (~1.2 GB)..." -ForegroundColor Yellow
    $flutterZip = Join-Path $env:TEMP "flutter_sdk.zip"
    $flutterUrl = "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.5-stable.zip"

    try {
        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($flutterUrl, $flutterZip)
    }
    catch {
        Write-Err "Download failed: $_"
        exit 1
    }

    Write-Host "    Extracting..." -ForegroundColor Yellow
    Expand-Archive -Path $flutterZip -DestinationPath $env:USERPROFILE -Force
    Remove-Item $flutterZip -Force -ErrorAction SilentlyContinue

    $flutterBinDir = Join-Path $flutterDir "bin"
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*flutter*bin*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$flutterBinDir", "User")
    }
    $env:Path += ";$flutterBinDir"
    Write-Ok "Flutter SDK installed"
}

flutter --disable-analytics 2>$null
dart --disable-analytics 2>$null

# =====================================================================
# 5. SING-BOX BINARY
# =====================================================================
Write-Step "5/6 sing-box"

$singboxVersion = "1.11.0"
$coreBuildDir = Join-Path $projectDir "core_build\windows"
$singboxExe = Join-Path $coreBuildDir "sing-box.exe"

if (-not (Test-Path $coreBuildDir)) {
    New-Item -ItemType Directory -Path $coreBuildDir -Force | Out-Null
}

if ((Test-Path $singboxExe) -and (-not $Force)) {
    Write-Ok "sing-box.exe already exists"
}
else {
    Write-Host "    Downloading sing-box v$singboxVersion..." -ForegroundColor Yellow
    $url = "https://github.com/SagerNet/sing-box/releases/download/v$singboxVersion/sing-box-$singboxVersion-windows-amd64.zip"
    $zip = Join-Path $env:TEMP "sing-box.zip"

    try {
        (New-Object Net.WebClient).DownloadFile($url, $zip)
        $tmp = Join-Path $env:TEMP "sing-box-extract"
        if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
        Expand-Archive -Path $zip -DestinationPath $tmp -Force

        $exe = Get-ChildItem -Path $tmp -Recurse -Filter "sing-box.exe" | Select-Object -First 1
        if ($exe) {
            Copy-Item $exe.FullName -Destination $singboxExe -Force
            $mb = [math]::Round((Get-Item $singboxExe).Length / 1MB, 1)
            Write-Ok "sing-box.exe ($mb MB)"
        }
        else { Write-Err "sing-box.exe not found in archive" }

        Remove-Item $zip -Force -ErrorAction SilentlyContinue
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    catch {
        Write-Err "Download failed: $_"
    }
}

# =====================================================================
# 6. FLUTTER PROJECT DEPS + WAIT FOR VS
# =====================================================================
if ($vsJob) {
    Write-Step "Waiting for VS Build Tools..."
    $vsJob | Wait-Job | Out-Null
    $vsResult = $vsJob | Receive-Job 2>&1
    $vsJob | Remove-Job
    Write-Ok "VS Build Tools ready"
}

Write-Step "6/6 Flutter project dependencies"
if (Get-Command flutter -ErrorAction SilentlyContinue) {
    Push-Location $projectDir
    flutter pub get 2>$null
    Pop-Location
    Write-Ok "pub get done"
}
else {
    Write-Err "Flutter not in PATH"
}

# =====================================================================
# DONE
# =====================================================================
$timer.Stop()
$mins = [math]::Round($timer.Elapsed.TotalMinutes, 1)

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Loader done in $mins min                  " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Next: restart terminal, then run:" -ForegroundColor White
Write-Host "    scripts\windows\runner.bat" -ForegroundColor Gray
Write-Host ""
