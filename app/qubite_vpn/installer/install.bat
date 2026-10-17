@echo off
:: Qubite VPN — Windows Installer
:: Run as Administrator: right-click -> Run as administrator
:: Or from PowerShell: irm https://raw.githubusercontent.com/kirillkuz1122/qubite/main/app/qubite_vpn/installer/install.ps1 | iex

setlocal enabledelayedexpansion

echo === Qubite VPN Installer ===
echo.

:: Check admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Run as Administrator required.
    echo     Right-click this file and select "Run as administrator"
    pause
    exit /b 1
)

set "INSTALL_DIR=%ProgramFiles%\QubiteVPN"
set "SCRIPT_DIR=%~dp0"

echo [1/5] Creating install directory...
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
mkdir "%INSTALL_DIR%"

echo [2/5] Copying files...
:: Copy everything from bundle next to this .bat OR from build dir
if exist "%SCRIPT_DIR%qubite_vpn.exe" (
    :: Installer is next to the built bundle
    xcopy "%SCRIPT_DIR%*" "%INSTALL_DIR%\" /E /I /Y /Q >nul
) else if exist "%SCRIPT_DIR%..\build\windows\x64\runner\Release\qubite_vpn.exe" (
    :: Run from repo root
    xcopy "%SCRIPT_DIR%..\build\windows\x64\runner\Release\*" "%INSTALL_DIR%\" /E /I /Y /Q >nul
) else (
    echo [ERROR] qubite_vpn.exe not found!
    echo Place this .bat next to the built app files, or run from the repo.
    pause
    exit /b 1
)

:: Remove installer bat from install dir (we don't need it there)
del "%INSTALL_DIR%\install.bat" 2>nul
del "%INSTALL_DIR%\install.ps1" 2>nul

echo [3/5] Creating Start Menu shortcut...
set "SHORTCUT=%ProgramData%\Microsoft\Windows\Start Menu\Programs\Qubite VPN.lnk"
powershell -NoProfile -Command ^
    "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%INSTALL_DIR%\qubite_vpn.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Qubite VPN'; $s.Save()"

echo [4/5] Creating Desktop shortcut...
set "DESKTOP_LINK=%PUBLIC%\Desktop\Qubite VPN.lnk"
powershell -NoProfile -Command ^
    "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%DESKTOP_LINK%'); $s.TargetPath = '%INSTALL_DIR%\qubite_vpn.exe'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Description = 'Qubite VPN'; $s.Save()"

echo [5/5] Adding to PATH and registry...
:: Add to Apps list (Programs and Features)
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN" /v "DisplayName" /t REG_SZ /d "Qubite VPN" /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN" /v "InstallLocation" /t REG_SZ /d "%INSTALL_DIR%" /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN" /v "UninstallString" /t REG_SZ /d "\"%INSTALL_DIR%\uninstall.bat\"" /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN" /v "DisplayVersion" /t REG_SZ /d "1.0.0" /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN" /v "Publisher" /t REG_SZ /d "Qubite" /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN" /v "NoModify" /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN" /v "NoRepair" /t REG_DWORD /d 1 /f >nul

:: Create uninstaller
(
echo @echo off
echo echo Uninstalling Qubite VPN...
echo rmdir /s /q "%INSTALL_DIR%"
echo del "%SHORTCUT%" 2^>nul
echo del "%DESKTOP_LINK%" 2^>nul
echo reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QubiteVPN" /f ^>nul 2^>^&1
echo echo Done.
echo pause
) > "%INSTALL_DIR%\uninstall.bat"

echo.
echo === Qubite VPN installed! ===
echo Location: %INSTALL_DIR%
echo Launch from Start Menu or Desktop shortcut.
echo.
pause
