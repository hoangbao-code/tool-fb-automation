@echo off
chcp 65001 > nul
title PostHub Desktop - Tự Động Hóa Zalo sang Facebook
color 0B

echo ===================================================================
echo     🚀 KHỞI ĐỘNG POSTHUB DESKTOP (BẢN MÁY TÍNH CHUYÊN DỤNG)
echo ===================================================================
echo.

cd /d "%~dp0"

:: 1. Kiểm tra Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Chưa tìm thấy Node.js! Vui lòng cài đặt Node.js từ https://nodejs.org
    pause
    exit /b 1
)

:: 2. Kiểm tra node_modules
if not exist "node_modules\" (
    echo [INFO] Đang cài đặt thư viện cần thiết lần đầu...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Cài đặt thư viện thất bại!
        pause
        exit /b 1
    )
)

echo [OK] Đang mở ứng dụng PostHub Desktop...
echo.

:: 3. Khởi chạy ứng dụng Electron Desktop
call npx electron .

if %errorlevel% neq 0 (
    pause
)
