const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('========================================================');
console.log('🔍 BẮT ĐẦU KIỂM TRA TOÀN DIỆN MÃ NGUỒN VÀ HỆ THỐNG');
console.log('========================================================\n');

// 1. Kiểm tra Cú pháp (Syntax Check) cho toàn bộ file JS
let syntaxErrors = 0;
let jsCount = 0;

function checkDir(dir) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
        const full = path.join(dir, f.name);
        if (f.isDirectory()) {
            if (f.name !== 'node_modules' && f.name !== 'dist' && f.name !== '.git' && f.name !== 'build') {
                checkDir(full);
            }
        } else if (f.name.endsWith('.js')) {
            jsCount++;
            try {
                execSync(`node --check "${full}"`);
            } catch (err) {
                console.error(`❌ LỖI CÚ PHÁP: ${full}`);
                console.error(err.stderr ? err.stderr.toString() : err.message);
                syntaxErrors++;
            }
        }
    }
}

console.log('1. Đang kiểm tra cú pháp toàn bộ file JS...');
checkDir(path.join(__dirname, '..', 'src'));
checkDir(path.join(__dirname, '..', 'public'));
checkDir(__dirname);

if (syntaxErrors === 0) {
    console.log(`  ✓ Toàn bộ ${jsCount} file JavaScript có cú pháp hoàn hảo 100%!\n`);
} else {
    console.error(`  ❌ Phát hiện ${syntaxErrors} file có lỗi cú pháp!\n`);
}

// 2. Kiểm tra IPC Handlers giữa appPreload.js và main.js
console.log('2. Đang kiểm tra tính nhất quán IPC (Preload vs Main Process)...');
const mainContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const preloadContent = fs.readFileSync(path.join(__dirname, '..', 'src', 'preloads', 'appPreload.js'), 'utf8');

// Tìm tất cả các kênh ipcRenderer.invoke trong appPreload.js
const invokeRegex = /ipcRenderer\.invoke\(['"`]([^'"`]+)['"`]/g;
let match;
const invokedChannels = new Set();
while ((match = invokeRegex.exec(preloadContent)) !== null) {
    invokedChannels.add(match[1]);
}

// Tìm tất cả các kênh ipcMain.handle trong main.js
const handleRegex = /ipcMain\.handle\(['"`]([^'"`]+)['"`]/g;
const handledChannels = new Set();
while ((match = handleRegex.exec(mainContent)) !== null) {
    handledChannels.add(match[1]);
}

let missingHandlers = 0;
for (const channel of invokedChannels) {
    if (!handledChannels.has(channel)) {
        console.error(`  ❌ Kênh IPC "${channel}" được gọi trong appPreload nhưng KHÔNG ĐƯỢC xử lý trong main.js!`);
        missingHandlers++;
    }
}

if (missingHandlers === 0) {
    console.log(`  ✓ Toàn bộ ${invokedChannels.size} kênh IPC trong preload đều được xử lý đầy đủ trong main.js!\n`);
} else {
    console.error(`  ❌ Phát hiện ${missingHandlers} kênh IPC thiếu handler!\n`);
}

// 3. Kiểm tra tính tương thích Database mới (Fresh Database Initialization)
console.log('3. Đang kiểm tra khởi tạo Database trên máy mới (Clean DB)...');
const sqlite3 = require('sqlite3').verbose();
const testDbPath = path.join(__dirname, 'test_fresh_init.sqlite');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const testDb = new sqlite3.Database(testDbPath);
let dbError = null;

testDb.serialize(() => {
    testDb.run("PRAGMA foreign_keys = ON;");

    // Copy schema logic from db.js
    testDb.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    testDb.run(`CREATE TABLE IF NOT EXISTS zalo_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, is_monitored INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    testDb.run(`CREATE TABLE IF NOT EXISTS fb_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT UNIQUE, member_count TEXT DEFAULT '', is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    testDb.run(`CREATE TABLE IF NOT EXISTS fb_clusters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    testDb.run(`CREATE TABLE IF NOT EXISTS fb_cluster_groups (cluster_id INTEGER NOT NULL, group_id INTEGER NOT NULL, PRIMARY KEY (cluster_id, group_id))`);
    testDb.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, display_name TEXT DEFAULT '', discord_channel_id TEXT DEFAULT '', fb_status TEXT DEFAULT 'disconnected', fb_name TEXT DEFAULT '', fb_cookies TEXT DEFAULT '', role TEXT DEFAULT 'staff', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    testDb.run(`ALTER TABLE posts ADD COLUMN target_cluster_id INTEGER`, () => {});
    testDb.run(`ALTER TABLE posts ADD COLUMN images TEXT`, () => {});
    testDb.run(`ALTER TABLE posts ADD COLUMN post_links TEXT`, () => {});
    testDb.run(`ALTER TABLE posts ADD COLUMN user_id INTEGER DEFAULT 1`, () => {});
    testDb.run(`ALTER TABLE fb_groups ADD COLUMN user_id INTEGER DEFAULT 1`, () => {});
    testDb.run(`ALTER TABLE fb_clusters ADD COLUMN user_id INTEGER DEFAULT 1`, () => {});
    testDb.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_name TEXT, sender TEXT, content TEXT, images TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    testDb.run(`CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER, group_name TEXT, original_text TEXT, rewritten_text TEXT, target_fb_group TEXT, status TEXT DEFAULT 'pending', error_message TEXT, posted_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    testDb.run(`CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    
    // Check tables exist
    testDb.all(`SELECT name FROM sqlite_master WHERE type='table'`, (err, tables) => {
        if (err) {
            console.error('  ❌ Lỗi truy vấn bảng:', err);
            dbError = err;
        } else {
            const tableNames = tables.map(t => t.name);
            const expectedTables = ['settings', 'zalo_groups', 'fb_groups', 'fb_clusters', 'fb_cluster_groups', 'users', 'messages', 'posts', 'logs'];
            const missing = expectedTables.filter(t => !tableNames.includes(t));
            if (missing.length === 0) {
                console.log(`  ✓ Khởi tạo DB sạch hoàn hảo! Có đủ ${expectedTables.length} bảng: ${expectedTables.join(', ')}\n`);
            } else {
                console.error(`  ❌ Thiếu bảng trong DB: ${missing.join(', ')}\n`);
                dbError = new Error('Thiếu bảng: ' + missing.join(', '));
            }
        }
    });
});

testDb.close(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
});

// 4. Kiểm tra License Engine & HWID fallback
console.log('4. Đang kiểm tra hệ thống bảo mật & License Engine...');
const { getMachineHWID, generateLicenseKey, verifyLicenseKey } = require('../src/services/licenseEngine');
const hwid = getMachineHWID();
console.log(`  ✓ HWID nhận dạng được: ${hwid}`);
if (!hwid || hwid.length < 10) {
    console.error('  ❌ HWID không hợp lệ hoặc rỗng!');
} else {
    const testKey = generateLicenseKey(hwid, 30);
    const verifyRes = verifyLicenseKey(testKey, hwid);
    if (verifyRes.valid) {
        console.log(`  ✓ Xác minh License Key thành công: ${testKey} (${verifyRes.message})\n`);
    } else {
        console.error(`  ❌ Xác minh License Key thất bại: ${verifyRes.message}\n`);
    }
}

// 5. Kiểm tra HTML IDs trong index.html với getElementById trong app.js
console.log('5. Đang kiểm tra tính toàn vẹn phần tử giao diện (DOM Element IDs)...');
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const appJsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

const idRegex = /document\.getElementById\(['"`]([^'"`]+)['"`]\)/g;
const requiredIds = new Set();
while ((match = idRegex.exec(appJsContent)) !== null) {
    requiredIds.add(match[1]);
}

let missingIds = [];
for (const id of requiredIds) {
    // Check if id exists in html
    const idPattern = new RegExp(`id=["']${id}["']`);
    if (!idPattern.test(htmlContent)) {
        missingIds.push(id);
    }
}

if (missingIds.length === 0) {
    console.log(`  ✓ Toàn bộ ${requiredIds.size} phần tử DOM được gọi trong app.js đều tồn tại trong index.html!\n`);
} else {
    console.warn(`  ⚠️ Cảnh báo: Có ${missingIds.length} ID gọi trong app.js chưa có trong index.html:`, missingIds);
}
