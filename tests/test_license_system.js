const assert = require('assert');
const {
    getMachineHWID,
    generateLicenseKey,
    verifyLicenseKey,
    checkCurrentLicense,
    saveLicenseKey
} = require('../src/services/licenseEngine');
const { dbAsync } = require('../src/db');

async function runTests() {
    console.log('\x1b[34m[Test] Bắt đầu kiểm thử Hệ thống Bản Quyền PostHub Pro (Hoàng Bảo)...\x1b[0m');

    // 1. Kiểm tra tạo mã máy HWID
    const hwid = getMachineHWID();
    console.log(`[Test] 1. HWID hiện tại: ${hwid}`);
    assert.ok(hwid.startsWith('HB-'), 'HWID phải bắt đầu bằng tiền tố HB-');
    assert.strictEqual(hwid.split('-').length, 5, 'HWID phải gồm 5 phần cách nhau bởi dấu gạch ngang (HB-XXXX-XXXX-XXXX-XXXX)');

    // 2. Tạo License Key vĩnh viễn (days = 0)
    const lifetimeKey = generateLicenseKey(hwid, 0);
    console.log(`[Test] 2. Key vĩnh viễn: ${lifetimeKey}`);
    assert.ok(lifetimeKey.startsWith('PHPRO-00000000-'), 'Key vĩnh viễn phải có mã thời gian 00000000');

    // Xác minh key vĩnh viễn
    const verifyLifetime = verifyLicenseKey(lifetimeKey, hwid);
    assert.strictEqual(verifyLifetime.valid, true, 'Key vĩnh viễn phải hợp lệ');
    assert.strictEqual(verifyLifetime.isLifetime, true, 'Phải đánh dấu isLifetime = true');

    // 3. Tạo License Key có thời hạn 30 ngày
    const days30Key = generateLicenseKey(hwid, 30);
    console.log(`[Test] 3. Key 30 ngày: ${days30Key}`);
    const verify30Days = verifyLicenseKey(days30Key, hwid);
    assert.strictEqual(verify30Days.valid, true, 'Key 30 ngày phải hợp lệ');
    assert.strictEqual(verify30Days.isLifetime, false, 'Không được đánh dấu là lifetime');
    assert.ok(verify30Days.daysLeft >= 29 && verify30Days.daysLeft <= 30, 'Số ngày còn lại phải là ~30');

    // 4. Kiểm tra Key với mã máy khác (Phòng ngừa chia sẻ key)
    const otherHwid = 'HB-9999-8888-7777-6666';
    const verifyWrongHwid = verifyLicenseKey(lifetimeKey, otherHwid);
    console.log(`[Test] 4. Thử kích hoạt key trên máy khác: Valid = ${verifyWrongHwid.valid} (Lỗi: ${verifyWrongHwid.error})`);
    assert.strictEqual(verifyWrongHwid.valid, false, 'Key máy này không được phép kích hoạt trên máy khác');

    // 5. Kiểm tra Key đã hết hạn (tạo giả lập exp trong quá khứ)
    const pastExp = (Math.floor(Date.now() / 1000) - 3600).toString(16).toUpperCase().padStart(8, '0');
    const crypto = require('crypto');
    const { DEFAULT_SECRET } = require('../src/services/licenseEngine');
    const expiredSig = crypto.createHmac('sha256', DEFAULT_SECRET)
        .update(`${hwid}:${pastExp}`)
        .digest('hex')
        .substring(0, 16)
        .toUpperCase();
    const expiredKey = `PHPRO-${pastExp}-${expiredSig.slice(0, 4)}-${expiredSig.slice(4, 8)}-${expiredSig.slice(8, 12)}-${expiredSig.slice(12, 16)}`;
    const verifyExpired = verifyLicenseKey(expiredKey, hwid);
    console.log(`[Test] 5. Kiểm tra key hết hạn: Valid = ${verifyExpired.valid}, Expired = ${verifyExpired.expired}`);
    assert.strictEqual(verifyExpired.valid, false, 'Key hết hạn không được hợp lệ');
    assert.strictEqual(verifyExpired.expired, true, 'Phải đánh dấu expired = true');

    // 6. Kiểm tra lưu và đọc bản quyền từ Database SQLite
    console.log('[Test] 6. Lưu và đọc bản quyền từ SQLite Database...');
    const saveResult = await saveLicenseKey(dbAsync, lifetimeKey);
    assert.strictEqual(saveResult.success, true, 'Lưu bản quyền vào DB phải thành công');

    const dbCheck = await checkCurrentLicense(dbAsync);
    assert.strictEqual(dbCheck.valid, true, 'Kiểm tra license từ DB phải hợp lệ');
    assert.strictEqual(dbCheck.isLifetime, true, 'Bản quyền trong DB phải là vĩnh viễn');

    console.log('\x1b[32m[Test] ✓ TẤT CẢ CÁC BÀI KIỂM THỬ HỆ THỐNG BẢN QUYỀN ĐÃ VƯỢT QUA 100%!\x1b[0m');
}

runTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('\x1b[31m[Test] ❌ Thất bại:\x1b[0m', err);
    process.exit(1);
});
