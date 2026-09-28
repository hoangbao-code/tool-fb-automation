const path = require('path');
const fs = require('fs');

/**
 * Lấy đường dẫn thư mục lưu trữ dữ liệu an toàn
 * Trong môi trường đóng gói (packaged .exe / asar), luôn trỏ về AppData/Roaming/posthub-desktop/data
 * để tránh lỗi ENOTDIR (do asar là file nén không phải thư mục ghi được).
 */
function getDataDir(subDir = '') {
    let baseDataDir;
    try {
        const electron = require('electron');
        const app = electron?.app || (electron?.remote?.app);
        if (app && typeof app.getPath === 'function') {
            baseDataDir = path.join(app.getPath('userData'), 'data');
        } else {
            baseDataDir = path.join(__dirname, '..', 'data');
        }
    } catch (e) {
        baseDataDir = path.join(__dirname, '..', 'data');
    }

    const fullPath = subDir ? path.join(baseDataDir, subDir) : baseDataDir;
    try {
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    } catch (err) {}

    // Tự động đồng bộ database ban đầu nếu database đích chưa có
    try {
        const targetDb = path.join(baseDataDir, 'posthub_desktop.sqlite');
        const sourceDb = path.join(__dirname, '..', 'data', 'posthub_desktop.sqlite');
        if (!fs.existsSync(targetDb) && fs.existsSync(sourceDb)) {
            fs.copyFileSync(sourceDb, targetDb);
        }
    } catch (e) {}

    return fullPath;
}

module.exports = {
    getDataDir
};
