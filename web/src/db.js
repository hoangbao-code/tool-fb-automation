const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'posthub.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Bảng cài đặt
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    // Bảng nhóm Zalo theo dõi
    db.run(`
        CREATE TABLE IF NOT EXISTS zalo_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            is_monitored INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Bảng nhóm Facebook đích
    db.run(`
        CREATE TABLE IF NOT EXISTS fb_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            url TEXT UNIQUE,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Bảng tin nhắn Zalo nhận về
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

    // Bảng hàng đợi bài đăng Facebook
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

    // Bảng nhật ký hoạt động
    db.run(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT,
            message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Thiết lập cấu hình mặc định nếu chưa có
    const defaultSettings = [
        ['gemini_api_key', ''],
        ['gemini_model', 'gemini-1.5-flash'],
        ['ai_prompt_template', `Bạn là chuyên gia marketing & sáng tạo nội dung mạng xã hội. Hãy viết lại bài đăng sau đây từ nhóm Zalo thành một bài đăng Facebook hấp dẫn, chuyên nghiệp, giữ đúng các thông tin cốt lõi (giá cả, địa chỉ, số điện thoại liên hệ), có thêm icon sinh động và hashtag liên quan:\n\nNội dung gốc:\n{CONTENT}`],
        ['auto_post_enabled', '0'],
        ['delay_min_seconds', '180'],
        ['delay_max_seconds', '480'],
        ['fb_posting_mode', 'assisted'], // 'assisted' hoặc 'auto'
        ['fb_cookie', '']
    ];

    defaultSettings.forEach(([key, val]) => {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, val]);
    });
});

// Helper promises cho database
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
    log: async (level, message) => {
        try {
            await dbAsync.run(`INSERT INTO logs (level, message) VALUES (?, ?)`, [level, message]);
            console.log(`[${level.toUpperCase()}] ${message}`);
        } catch (e) {
            console.error('Log error:', e);
        }
    }
};

module.exports = { db, dbAsync };
