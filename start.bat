@echo off
title PostHub PC - Tu Dong Hoa Zalo sang Facebook
color 0B

echo ===================================================================
echo     POSTHUB PC - UNG DUNG TU DONG HOA ZALO SANG FACEBOOK
echo ===================================================================
echo.

cd /d "%~dp0"

:: 1. Kiem tra & bo sung PATH cho Node.js neu can
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=%PATH%;C:\Program Files\nodejs;C:\Users\%USERNAME%\AppData\Roaming\npm"
    )
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Khong tim thay Node.js tren may tinh!
    echo Vui long cai dat Node.js tu trang: https://nodejs.org
    echo Sau khi cai dat xong, hay mo lai file nay.
    echo.
    pause
    exit /b 1
)

:: 2. Kiem tra va cai dat thu vien neu chua co
if not exist "node_modules\" (
    echo [INFO] Dang cai dat thu vien can thiet cho lan chay dau tien...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Cai dat thu vien that bai! Vui long kiem tra ket noi mang.
        pause
        exit /b 1
    )
)

:: 3. Khoi chay ung dung PostHub Desktop
echo [OK] Dang khoi chay ung dung PostHub Desktop...
echo.

call npm start

if %errorlevel% neq 0 (
    echo.
    echo [INFO] Ung dung da dong lai (Ma thoat: %errorlevel%).
    pause
)
