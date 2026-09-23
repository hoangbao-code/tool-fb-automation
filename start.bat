@echo off
title PostHub PC - Tu Dong Hoa Zalo sang Facebook
color 0B

echo ===================================================================
echo     POSTHUB PC - TU DONG HOA ZALO SANG FACEBOOK (DESKTOP)
echo ===================================================================
echo.

set "PROJECT_DIR=C:\Users\bao\.gemini\antigravity\scratch\zalo_fb_poster_apk"
if exist "%~dp0package.json" (
    set "PROJECT_DIR=%~dp0"
)

echo [INFO] Thu muc ung dung: %PROJECT_DIR%
cd /d "%PROJECT_DIR%"

:: Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
    )
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay Node.js tren may tinh!
    echo Vui long cai dat Node.js tu: https://nodejs.org
    pause
    exit /b 1
)

:: Kiem tra thu vien
if not exist "node_modules\" (
    echo [INFO] Dang cai dat thu vien can thiet...
    call npm.cmd install
    if %errorlevel% neq 0 (
        echo [LOI] Cai dat thu vien that bai!
        pause
        exit /b 1
    )
)

:: Khoi chay ung dung
echo [OK] Dang khoi chay PostHub Desktop...
echo.

call npm.cmd start

if %errorlevel% neq 0 (
    echo.
    echo [THONG BAO] Ung dung da dong (Ma thoat: %errorlevel%).
    pause
)
