@echo off
chcp 65001 >nul 2>&1
echo.
echo  Qubite VPN - Loader (Windows)
echo  ==============================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo  [!] Needs admin rights.
    echo      Right-click and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0loader.ps1" %*

echo.
pause >nul
