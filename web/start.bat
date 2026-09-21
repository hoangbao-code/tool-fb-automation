@echo off
chcp 65001 > nul
title PostHub - Zalo to Facebook Auto-Poster (Web Desktop)
color 0B

echo ===================================================================
echo     🚀 KHỞI ĐỘNG POSTHUB - TỰ ĐỘNG HÓA ZALO SANG FACEBOOK
echo ===================================================================
echo.

cd /d "%~dp0"

:: 1. Kiểm tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Không tìm thấy Node.js trên máy tính của bạn!
    echo Vui lòng cài đặt Node.js từ https://nodejs.org để chạy công cụ.
    echo.
    pause
    exit /b 1
)

:: 2. Kiểm tra thư viện node_modules
if not exist "node_modules\" (
    echo [INFO] Đang cài đặt thư viện cần thiết lần đầu...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Cài đặt thư viện thất bại!
        pause
        exit /b 1
    )
)

echo.
echo [OK] Đang khởi chạy hệ thống Web Server tại http://localhost:3000...
echo.

:: 3. Tự động mở trình duyệt sau 2 giây
start "" http://localhost:3000

:: 4. Chạy Node.js Server
node src/server.js

pause
