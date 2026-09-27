@echo off
setlocal
chcp 65001 >nul
title PostHub Pro - Tự Động Hóa Quản Lý Tin Đăng
color 0F

set "NODE_NO_WARNINGS=1"
set "PROJECT_DIR=%~dp0"
if not exist "%PROJECT_DIR%package.json" (
    set "PROJECT_DIR=C:\Users\bao\.gemini\antigravity\scratch\zalo_fb_poster_apk"
)
cd /d "%PROJECT_DIR%"

cls
echo.
echo  =============================================================================
echo    ██████╗  ██████╗ ███████╗████████╗██╗  ██╗██╗   ██╗██████╗ 
echo    ██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██║  ██║██║   ██║██╔══██╗
echo    ██████╔╝██║   ██║███████╗   ██║   ███████║██║   ██║██████╔╝
echo    ██╔═══╝ ██║   ██║╚════██║   ██║   ██╔══██║██║   ██║██╔══██╗
echo    ██║     ╚██████╔╝███████║   ██║   ██║  ██║╚██████╔╝██████╔╝
echo    ╚═╝      ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ 
echo                   HỆ THỐNG TỰ ĐỘNG HÓA BĐS & ĐA KÊNH v2.1
echo  =============================================================================
echo.

:: Kiem tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
    )
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [X] LOI: Khong tim thay Node.js tren may tinh!
    echo      Vui long cai dat Node.js tu: https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Kiem tra thu vien
if not exist "node_modules\" (
    echo  [*] Dang thiet lap cac thanh phan he thong lan dau...
    call npm.cmd install --silent --no-audit --no-fund
    if %errorlevel% neq 0 (
        echo  [X] Cai dat thanh phan that bai!
        pause
        exit /b 1
    )
)

echo  [OK] Khoi chay thanh cong moi truong PostHub Pro.
echo  [*] Dang khoi dong giao dien Desktop va cac tien trinh tu dong...
echo.

:: Khoi chay Electron truc tiep, khong hien thi thong bao rac npm
if exist "node_modules\.bin\electron.cmd" (
    call "node_modules\.bin\electron.cmd" .
) else (
    call npx.cmd electron .
)

if %errorlevel% neq 0 (
    echo.
    echo  [THONG BAO] Ung dung da dong (Ma: %errorlevel%).
    pause
)
