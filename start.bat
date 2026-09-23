@echo off
chcp 65001 >nul
title PostHub PC - Tự Động Hóa Zalo sang Facebook
color 0B

:: 1. Xác định thư mục dự án PostHub
set "PROJECT_DIR=C:\Users\bao\.gemini\antigravity\scratch\zalo_fb_poster_apk"
if exist "%~dp0package.json" (
    set "PROJECT_DIR=%~dp0"
)

echo ===================================================================
echo     POSTHUB PC - TỰ ĐỘNG HÓA ZALO SANG FACEBOOK (DESKTOP)
echo ===================================================================
echo [INFO] Đang mở từ thư mục: %PROJECT_DIR%
echo.

cd /d "%PROJECT_DIR%"

:: 2. Kiểm tra & Bổ sung PATH cho Node.js nếu cần
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
    )
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LỖI] Không tìm thấy Node.js trên máy tính!
    echo Vui lòng cài đặt Node.js từ trang: https://nodejs.org
    echo Sau khi cài đặt xong, hãy mở lại file này.
    echo.
    pause
    exit /b 1
)

:: 3. Kiểm tra và cài đặt thư viện nếu chưa có
if not exist "node_modules\" (
    echo [INFO] Đang cài đặt thư viện cần thiết lần đầu...
    call npm install
    if %errorlevel% neq 0 (
        echo [LỖI] Cài đặt thư viện thất bại! Vui lòng kiểm tra kết nối mạng.
        pause
        exit /b 1
    )
)

:: 4. Khởi chạy ứng dụng PostHub Desktop
echo [OK] Đang khởi chạy ứng dụng PostHub Desktop...
echo.

call npm start

if %errorlevel% neq 0 (
    echo.
    echo [THÔNG BÁO] Ứng dụng đã đóng lại (Mã thoát: %errorlevel%).
    pause
)
