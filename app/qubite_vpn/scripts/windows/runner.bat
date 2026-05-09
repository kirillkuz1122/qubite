@echo off
chcp 65001 >nul 2>&1

echo.
echo  Qubite VPN - Runner (Windows)
echo  ==============================
echo.

:: Find project root (scripts\windows\runner.bat -> project root)
set "PROJECT_DIR=%~dp0..\.."
pushd "%PROJECT_DIR%"
set "PROJECT_DIR=%CD%"
popd

:: Check Flutter
where flutter >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] Flutter not found in PATH.
    echo        Run loader.bat first, then restart terminal.
    echo.
    pause
    exit /b 1
)

:: Check sing-box
if not exist "%PROJECT_DIR%\core_build\windows\sing-box.exe" (
    echo  [WARN] sing-box.exe not found in core_build\windows\
    echo         VPN core will not work. Run loader.bat to download it.
    echo.
)

:: Check pub dependencies
if not exist "%PROJECT_DIR%\.dart_tool\package_config.json" (
    echo  [*] Running flutter pub get...
    cd /d "%PROJECT_DIR%"
    flutter pub get
    echo.
)

:: Run mode selection
echo  Select mode:
echo    1. Debug   (hot reload, slow startup)
echo    2. Release (fast, no debug)
echo    3. Build only (create .exe in build\)
echo.
set /p MODE="  Choice [1]: "

if "%MODE%"=="" set MODE=1

cd /d "%PROJECT_DIR%"

if "%MODE%"=="1" (
    echo.
    echo  [*] Starting in debug mode...
    echo      Press 'r' for hot reload, 'q' to quit
    echo.
    flutter run -d windows
    goto :done
)
if "%MODE%"=="2" (
    echo.
    echo  [*] Starting in release mode...
    echo.
    flutter run -d windows --release
    goto :done
)
if "%MODE%"=="3" (
    echo.
    echo  [*] Building release .exe...
    echo.
    flutter build windows --release
    if %errorLevel% neq 0 (
        echo.
        echo  [ERR] Build failed! See errors above.
        echo.
        goto :done
    )
    echo.
    echo  [OK] Build at: %PROJECT_DIR%\build\windows\x64\runner\Release\
    echo.
    set /p OPENDIR="  Open build folder? [y/N]: "
    if /i "%OPENDIR%"=="y" explorer "%PROJECT_DIR%\build\windows\x64\runner\Release"
    goto :done
)

:done
echo.
echo  Press any key to exit...
pause >nul
