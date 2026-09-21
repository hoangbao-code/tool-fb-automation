const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'posthub_desktop.sqlite');
const db = new sqlite3.Database(dbPath);

let logCallback = null;

db.serialize(() => {
    // 1. Cài đặt hệ thống
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    // 2. Nhóm Zalo theo dõi
    db.run(`
        CREATE TABLE IF NOT EXISTS zalo_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            is_monitored INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 3. Nhóm Facebook đã quét được
    db.run(`
        CREATE TABLE IF NOT EXISTS fb_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            url TEXT UNIQUE,
            member_count TEXT DEFAULT '',
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 4. Tin nhắn Zalo đã bắt được
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_name TEXT,
            sender TEXT,
            content TEXT,
            images TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 5. Hàng đợi bài viết Facebook
    db.run(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER,
            group_name TEXT,
            original_text TEXT,
            rewritten_text TEXT,
            target_fb_group TEXT,
            status TEXT DEFAULT 'pending', -- pending, approved, posted, failed
            error_message TEXT,
            posted_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 6. Nhật ký hoạt động
    db.run(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT,
            message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Giá trị cấu hình mặc định
    const defaultSettings = [
        ['gemini_api_key', ''],
        ['gemini_model', 'gemini-1.5-flash'],
        ['ai_prompt_template', `Bạn là chuyên gia marketing mạng xã hội. Hãy viết lại bài đăng sau đây từ nhóm Zalo thành một bài đăng Facebook hấp dẫn, chuyên nghiệp, giữ đúng toàn bộ thông tin quan trọng (giá, địa chỉ, số điện thoại liên hệ), có thêm icon sinh động và hashtag liên quan:\n\nNội dung gốc:\n{CONTENT}`],
        ['auto_post_enabled', '0'],
        ['delay_min_seconds', '180'],
        ['delay_max_seconds', '480'],
        ['emergency_stop', '0']
    ];

    defaultSettings.forEach(([key, val]) => {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, val]);
    });
});

const dbAsync = {
    get: (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    }),
    all: (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    }),
    run: (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    }),
    setLogListener: (cb) => { logCallback = cb; },
    log: async (level, message) => {
        try {
            const timeStr = new Date().toISOString();
            await dbAsync.run(`INSERT INTO logs (level, message) VALUES (?, ?)`, [level, message]);
            console.log(`[${level.toUpperCase()}] ${message}`);
            if (logCallback) {
                logCallback({ level, message, created_at: timeStr });
            }
        } catch (e) {
            console.error('Log error:', e);
        }
    }
};

module.exports = { db, dbAsync };
