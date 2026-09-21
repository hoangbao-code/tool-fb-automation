# PostHub PC - Trình khởi chạy PowerShell 1-Click
$Host.UI.RawUI.WindowTitle = "PostHub PC - Tự Động Hóa Zalo sang Facebook"
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "    POSTHUB PC - ỨNG DỤNG TỰ ĐỘNG HÓA ZALO SANG FACEBOOK" -ForegroundColor Yellow
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

# 1. Bổ sung PATH Node.js nếu cần
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if (Test-Path "C:\Program Files\nodejs\node.exe") {
        $env:Path += ";C:\Program Files\nodejs;C:\Users\$env:USERNAME\AppData\Roaming\npm"
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Không tìm thấy Node.js trên máy tính!" -ForegroundColor Red
    Write-Host "Vui lòng cài đặt Node.js từ https://nodejs.org" -ForegroundColor White
    Read-Host "Nhấn Enter để thoát..."
    exit 1
}

# 2. Kiểm tra node_modules
if (-not (Test-Path "node_modules")) {
    Write-Host "[INFO] Đang cài đặt thư viện cần thiết lần đầu..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Cài đặt thư viện thất bại!" -ForegroundColor Red
        Read-Host "Nhấn Enter để thoát..."
        exit 1
    }
}

# 3. Khởi chạy Electron
Write-Host "[OK] Đang khởi chạy ứng dụng PostHub Desktop..." -ForegroundColor Green
npm start
