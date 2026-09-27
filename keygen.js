#!/usr/bin/env node

/**
 * =========================================================================
 *  POSTHUB PRO - BỘ CÔNG CỤ TẠO KEY BẢN QUYỀN (DÀNH CHO HOÀNG BẢO)
 * =========================================================================
 * 
 * Cách dùng nhanh từ dòng lệnh:
 *   node keygen.js [MÃ_MÁY_HWID] [SỐ_NGÀY]
 * 
 * Ví dụ:
 *   node keygen.js HB-1234-5678-9ABC-DEF0 30    (Tạo key 30 ngày)
 *   node keygen.js HB-1234-5678-9ABC-DEF0 0     (Tạo key vĩnh viễn)
 *   node keygen.js                              (Mở giao diện tương tác từng bước)
 */

const readline = require('readline');
const { getMachineHWID, generateLicenseKey, verifyLicenseKey } = require('./src/services/licenseEngine');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

function printBanner() {
    console.log('\x1b[36m' + `
  ██████╗  ██████╗ ███████╗████████╗██╗  ██╗██╗   ██╗██████╗ 
  ██╔══██╗██╔═══██╗██╔════╝╚══██╔══╝██║  ██║██║   ██║██╔══██╗
  ██████╔╝██║   ██║███████╗   ██║   ███████║██║   ██║██████╔╝
  ██╔═══╝ ██║   ██║╚════██║   ██║   ██╔══██║██║   ██║██╔══██╗
  ██║     ╚██████╔╝███████║   ██║   ██║  ██║╚██████╔╝██████╔╝
  ╚═╝      ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ 
    >>> BỘ CÔNG CỤ PHÁT HÀNH BẢN QUYỀN CHÍNH THỨC - HOÀNG BẢO <<<
` + '\x1b[0m');
}

function displayResult(hwid, days, key, verifyInfo) {
    const term = days === 0 ? 'VĨNH VIỄN (LIFETIME)' : `${days} NGÀY (Hết hạn: ${new Date(Date.now() + days * 86400000).toLocaleDateString('vi-VN')})`;

    console.log('\n\x1b[32m' + '=======================================================================' + '\x1b[0m');
    console.log('\x1b[1m\x1b[33m  🎉 TẠO LICENSE KEY THÀNH CÔNG CHO KHÁCH HÀNG!\x1b[0m');
    console.log('\x1b[32m' + '=======================================================================' + '\x1b[0m');
    console.log(`  🖥️  Mã máy khách (HWID) : \x1b[36m${hwid}\x1b[0m`);
    console.log(`  ⏳ Thời hạn bản quyền   : \x1b[35m${term}\x1b[0m`);
    console.log(`  🔑 MÃ BẢN QUYỀN (KEY)   : \x1b[1m\x1b[92m${key}\x1b[0m`);
    console.log('\x1b[32m' + '-----------------------------------------------------------------------' + '\x1b[0m');
    console.log('\x1b[1m\x1b[34m  📩 MẪU TIN NHẮN GỬI ZALO CHO KHÁCH HÀNG:\x1b[0m');
    console.log('\x1b[90m' + '  -------------------------------------------------------------------' + '\x1b[0m');
    console.log(`  Chào bạn, Hoàng Bảo gửi bạn mã kích hoạt bản quyền PostHub Pro:

  - Mã máy của bạn: ${hwid}
  - Gói bản quyền : ${term}
  - Mã kích hoạt  : ${key}

  👉 Bạn chỉ cần dán mã trên vào phần "Kích Hoạt Bản Quyền" trong phần mềm
  và ấn [KÍCH HOẠT NGAY] là có thể sử dụng toàn bộ tính năng.`);
    console.log('\x1b[90m' + '  -------------------------------------------------------------------' + '\x1b[0m');
    console.log('\x1b[32m' + '=======================================================================\n' + '\x1b[0m');
}

async function main() {
    const args = process.argv.slice(2);

    // 1. Chế độ CLI có đối số: node keygen.js [HWID] [DAYS]
    if (args.length >= 1) {
        const hwid = args[0].trim();
        const days = args[1] !== undefined ? parseInt(args[1], 10) : 30;

        try {
            const key = generateLicenseKey(hwid, days);
            const verifyInfo = verifyLicenseKey(key, hwid);
            printBanner();
            displayResult(hwid, days, key, verifyInfo);
        } catch (err) {
            console.error('\x1b[31m❌ Lỗi tạo key: ' + err.message + '\x1b[0m');
        }
        process.exit(0);
    }

    // 2. Chế độ tương tác tương tác từng bước
    printBanner();
    const currentMachineHwid = getMachineHWID();
    console.log(`\x1b[90m[Gợi ý] Mã máy tính hiện tại của bạn: ${currentMachineHwid}\x1b[0m\n`);

    const inputHwid = await ask('👉 Nhập mã máy HWID của khách (Enter để dùng mã máy hiện tại): ');
    const hwid = (inputHwid && inputHwid.trim()) ? inputHwid.trim() : currentMachineHwid;

    if (!hwid.startsWith('HB-')) {
        console.log('\x1b[33m⚠️ Lưu ý: Mã máy chuẩn thường bắt đầu bằng "HB-XXXX-XXXX-XXXX-XXXX". Đang tiếp tục...\x1b[0m');
    }

    console.log('\n📌 Chọn gói thời hạn bản quyền:');
    console.log('  [1] Dùng thử 3 ngày (Trial)');
    console.log('  [2] Gói 1 Tháng (30 ngày)');
    console.log('  [3] Gói 3 Tháng (90 ngày)');
    console.log('  [4] Gói 1 Năm (365 ngày)');
    console.log('  [5] Bản quyền VĨNH VIỄN (Lifetime - 0)');
    console.log('  [6] Tùy chỉnh số ngày');

    const choice = await ask('\n👉 Chọn gói (1-6) [Mặc định 2]: ');
    let days = 30;

    switch ((choice || '').trim()) {
        case '1':
            days = 3;
            break;
        case '2':
        case '':
            days = 30;
            break;
        case '3':
            days = 90;
            break;
        case '4':
            days = 365;
            break;
        case '5':
            days = 0; // Vĩnh viễn
            break;
        case '6':
            const customDays = await ask('   Nhập số ngày hiệu lực (0 = Vĩnh viễn): ');
            days = parseInt(customDays, 10) || 0;
            break;
        default:
            days = 30;
            break;
    }

    try {
        const key = generateLicenseKey(hwid, days);
        const verifyInfo = verifyLicenseKey(key, hwid);
        displayResult(hwid, days, key, verifyInfo);
    } catch (err) {
        console.error('\x1b[31m❌ Lỗi tạo key: ' + err.message + '\x1b[0m');
    }

    rl.close();
}

if (require.main === module) {
    main();
}

module.exports = { generateLicenseKey, verifyLicenseKey };
