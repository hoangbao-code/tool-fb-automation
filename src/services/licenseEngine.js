const crypto = require('crypto');
const os = require('os');
const cp = require('child_process');

// Khóa bảo mật ký số bản quyền PostHub Pro của Hoàng Bảo
const DEFAULT_SECRET = 'HOANG_BAO_POSTHUB_PRO_SECRET_KEY_SECURE_2026_@!';

/**
 * Lấy mã định danh phần cứng duy nhất (HWID) của máy tính.
 * Định dạng chuẩn: HB-XXXX-XXXX-XXXX-XXXX
 */
function getMachineHWID() {
    let rawIdentifier = '';

    // 1. Thử lấy MachineGuid từ Windows Registry
    try {
        if (os.platform() === 'win32') {
            const output = cp.execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true,
                timeout: 3000
            }).toString();
            const match = output.match(/MachineGuid\s+REG_SZ\s+([a-zA-Z0-9_-]+)/i);
            if (match && match[1]) {
                rawIdentifier = match[1].trim();
            }
        }
    } catch (e) {
        // Fallback bên dưới nếu không đọc được registry
    }

    // 2. Nếu không lấy được MachineGuid hoặc ở OS khác, kết hợp thông số phần cứng
    if (!rawIdentifier) {
        const cpus = os.cpus() || [];
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'UnknownCPU';
        const hostname = os.hostname() || 'UnknownHost';
        const platform = os.platform() || 'win32';
        const arch = os.arch() || 'x64';
        const totalMem = Math.round(os.totalmem() / (1024 * 1024 * 1024)); // GB
        rawIdentifier = `${hostname}_${platform}_${arch}_${cpuModel}_${totalMem}GB`;
    }

    // Băm SHA256 và cắt lấy 16 ký tự phân bổ thành 4 nhóm
    const hash = crypto.createHash('sha256').update(`POSTHUB_HWID_${rawIdentifier}`).digest('hex').toUpperCase();
    const part1 = hash.substring(0, 4);
    const part2 = hash.substring(4, 8);
    const part3 = hash.substring(8, 12);
    const part4 = hash.substring(12, 16);

    return `HB-${part1}-${part2}-${part3}-${part4}`;
}

/**
 * Tạo License Key dành riêng cho 1 mã máy HWID.
 * @param {string} hwid - Mã máy định dạng HB-XXXX-XXXX-XXXX-XXXX
 * @param {number} days - Số ngày hiệu lực (0 hoặc null = Vĩnh viễn)
 * @param {string} [secret] - Khóa bí mật
 * @returns {string} - License key có định dạng PHPRO-XXXXXXXX-XXXX-XXXX-XXXX-XXXX
 */
function generateLicenseKey(hwid, days = 0, secret = DEFAULT_SECRET) {
    if (!hwid || typeof hwid !== 'string') {
        throw new Error('Mã máy (HWID) không hợp lệ!');
    }

    const cleanHwid = hwid.trim().toUpperCase();
    let expTimestamp = 0;

    if (days && days > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        expTimestamp = nowSec + (parseInt(days, 10) * 86400);
    }

    // Mã hóa thời gian hết hạn thành chuỗi Hex 8 ký tự (00000000 = Vĩnh viễn)
    const expHex = expTimestamp.toString(16).toUpperCase().padStart(8, '0');

    // Ký số HMAC-SHA256 trên chuỗi [HWID + EXP_HEX]
    const payload = `${cleanHwid}:${expHex}`;
    const signature = crypto.createHmac('sha256', secret)
        .update(payload)
        .digest('hex')
        .substring(0, 16)
        .toUpperCase();

    // Định dạng: PHPRO-EXP8-SIG4-SIG4-SIG4-SIG4
    const s1 = signature.substring(0, 4);
    const s2 = signature.substring(4, 8);
    const s3 = signature.substring(8, 12);
    const s4 = signature.substring(12, 16);

    return `PHPRO-${expHex}-${s1}-${s2}-${s3}-${s4}`;
}

/**
 * Xác minh tính hợp lệ của License Key trên máy tính hiện tại hoặc HWID được cung cấp.
 * @param {string} licenseKey - Mã kích hoạt cần kiểm tra
 * @param {string} [currentHwid] - Mã máy để kiểm tra (mặc định lấy HWID hiện tại)
 * @param {string} [secret] - Khóa bí mật
 */
function verifyLicenseKey(licenseKey, currentHwid = null, secret = DEFAULT_SECRET) {
    if (!licenseKey || typeof licenseKey !== 'string') {
        return {
            valid: false,
            error: 'Vui lòng nhập mã kích hoạt bản quyền!'
        };
    }

    const targetHwid = (currentHwid || getMachineHWID()).trim().toUpperCase();
    const cleanKey = licenseKey.trim().toUpperCase();

    // Kiểm tra định dạng PHPRO-XXXXXXXX-XXXX-XXXX-XXXX-XXXX
    const regex = /^PHPRO-([0-9A-F]{8})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{4})$/;
    const match = cleanKey.match(regex);

    if (!match) {
        return {
            valid: false,
            error: 'Định dạng mã kích hoạt không hợp lệ! (Định dạng chuẩn: PHPRO-XXXXXXXX-XXXX-XXXX-XXXX-XXXX)'
        };
    }

    const expHex = match[1];
    const keySig = `${match[2]}${match[3]}${match[4]}${match[5]}`;

    // Tính chữ ký dự kiến dựa trên HWID này
    const payload = `${targetHwid}:${expHex}`;
    const expectedSig = crypto.createHmac('sha256', secret)
        .update(payload)
        .digest('hex')
        .substring(0, 16)
        .toUpperCase();

    if (keySig !== expectedSig) {
        return {
            valid: false,
            error: 'Mã kích hoạt không đúng hoặc không dành cho máy tính này!'
        };
    }

    // Kiểm tra hạn sử dụng
    const expTimestamp = parseInt(expHex, 16);
    if (expTimestamp === 0) {
        return {
            valid: true,
            isLifetime: true,
            expireAt: null,
            daysLeft: 'Vĩnh viễn',
            message: 'Bản quyền vĩnh viễn (Lifetime License)'
        };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec > expTimestamp) {
        const expiredDate = new Date(expTimestamp * 1000).toLocaleDateString('vi-VN');
        return {
            valid: false,
            expired: true,
            expireAt: new Date(expTimestamp * 1000).toISOString(),
            error: `Bản quyền đã hết hạn vào ngày ${expiredDate}. Vui lòng liên hệ Hoàng Bảo để gia hạn!`
        };
    }

    const diffDays = Math.ceil((expTimestamp - nowSec) / 86400);
    const expireDateFormatted = new Date(expTimestamp * 1000).toLocaleDateString('vi-VN');

    return {
        valid: true,
        isLifetime: false,
        expireAt: new Date(expTimestamp * 1000).toISOString(),
        daysLeft: diffDays,
        message: `Bản quyền hợp lệ! Hạn dùng đến: ${expireDateFormatted} (còn ${diffDays} ngày)`
    };
}

/**
 * Kiểm tra trạng thái bản quyền hiện tại từ database
 */
async function checkCurrentLicense(dbAsync) {
    const hwid = getMachineHWID();
    try {
        const row = await dbAsync.get(`SELECT value FROM settings WHERE key = 'license_key'`);
        if (!row || !row.value) {
            return {
                valid: false,
                isActivated: false,
                hwid,
                error: 'Máy tính chưa kích hoạt bản quyền PostHub Pro!'
            };
        }

        const verifyResult = verifyLicenseKey(row.value, hwid);
        return {
            ...verifyResult,
            isActivated: verifyResult.valid,
            hwid,
            key: row.value
        };
    } catch (e) {
        return {
            valid: false,
            isActivated: false,
            hwid,
            error: 'Lỗi truy vấn cơ sở dữ liệu: ' + e.message
        };
    }
}

/**
 * Lưu mã kích hoạt vào database nếu hợp lệ
 */
async function saveLicenseKey(dbAsync, licenseKey) {
    const hwid = getMachineHWID();
    const verifyResult = verifyLicenseKey(licenseKey, hwid);

    if (!verifyResult.valid) {
        return {
            success: false,
            ...verifyResult,
            hwid
        };
    }

    try {
        await dbAsync.run(
            `INSERT INTO settings (key, value) VALUES ('license_key', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            [licenseKey.trim().toUpperCase()]
        );
        return {
            success: true,
            ...verifyResult,
            hwid,
            key: licenseKey.trim().toUpperCase()
        };
    } catch (e) {
        return {
            success: false,
            valid: false,
            error: 'Không thể lưu bản quyền vào cơ sở dữ liệu: ' + e.message
        };
    }
}

module.exports = {
    DEFAULT_SECRET,
    getMachineHWID,
    generateLicenseKey,
    verifyLicenseKey,
    checkCurrentLicense,
    saveLicenseKey
};
