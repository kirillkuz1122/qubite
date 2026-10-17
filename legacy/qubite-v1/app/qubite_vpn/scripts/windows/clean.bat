@echo off
chcp 65001 >nul 2>&1
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Run as Administrator!
    pause
    exit /b 1
)
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0clean.ps1" %*
pause >nul
