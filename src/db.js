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

    // 3.1 Cụm Nhóm Facebook (Group Clusters)
    db.run(`
        CREATE TABLE IF NOT EXISTS fb_clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 3.2 Bảng ánh xạ Nhóm thuộc Cụm (Many-to-Many)
    db.run(`
        CREATE TABLE IF NOT EXISTS fb_cluster_groups (
            cluster_id INTEGER NOT NULL,
            group_id INTEGER NOT NULL,
            PRIMARY KEY (cluster_id, group_id),
            FOREIGN KEY (cluster_id) REFERENCES fb_clusters(id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES fb_groups(id) ON DELETE CASCADE
        )
    `);

    // 3.3 Bảng Người Dùng & Nhân Viên (Multi-User SaaS)
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            display_name TEXT DEFAULT '',
            discord_channel_id TEXT DEFAULT '',
            fb_status TEXT DEFAULT 'disconnected',
            fb_name TEXT DEFAULT '',
            fb_cookies TEXT DEFAULT '',
            role TEXT DEFAULT 'staff',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tự động nâng cấp cột bảng posts nếu thiếu
    db.run(`ALTER TABLE posts ADD COLUMN target_cluster_id INTEGER`, () => {});
    db.run(`ALTER TABLE posts ADD COLUMN images TEXT`, () => {});
    db.run(`ALTER TABLE posts ADD COLUMN post_links TEXT`, () => {});
    db.run(`ALTER TABLE posts ADD COLUMN user_id INTEGER DEFAULT 1`, () => {});

    // Tự động nâng cấp cột user_id cho fb_groups và fb_clusters
    db.run(`ALTER TABLE fb_groups ADD COLUMN user_id INTEGER DEFAULT 1`, () => {});
    db.run(`ALTER TABLE fb_clusters ADD COLUMN user_id INTEGER DEFAULT 1`, () => {});

    // Tạo tài khoản admin mặc định nếu chưa có
    db.run(`
        INSERT OR IGNORE INTO users (id, username, password, display_name, role)
        VALUES (1, 'admin', 'admin123', 'Quản Trị Viên (Admin)', 'admin')
    `, () => {});

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
        ['gemini_model', 'gemini-3.7-flash'],
        ['ai_prompt_template', `Bạn là chuyên gia marketing mạng xã hội. Hãy viết lại bài đăng sau đây từ nhóm Zalo thành một bài đăng Facebook hấp dẫn, chuyên nghiệp, giữ đúng toàn bộ thông tin quan trọng (giá, địa chỉ, số điện thoại liên hệ), có thêm icon sinh động và hashtag liên quan:\n\nNội dung gốc:\n{CONTENT}`],
        ['auto_post_enabled', '0'],
        ['delay_min_seconds', '180'],
        ['delay_max_seconds', '480'],
        ['emergency_stop', '0'],
        ['custom_signature', ''],
        ['custom_hashtags', '#bds #nhadep #chothue #giatot'],
        ['ai_spin_enabled', '1'],
        ['smart_scheduler_enabled', '0'],
        ['smart_scheduler_slots', JSON.stringify([
            { start: "08:00", end: "09:30" },
            { start: "11:30", end: "13:00" },
            { start: "19:30", end: "21:30" }
        ])],
        ['gemini_conversation_url', ''],
        ['gemini_send_raw_content', '1'],
        ['discord_bot_enabled', '0'],
        ['discord_bot_token', ''],
        ['discord_channel_id', ''],
        ['discord_debounce_seconds', '60'],
        ['discord_image_save_dir', '']
    ];

    defaultSettings.forEach(([key, val]) => {
        db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [key, val]);
    });

    // Tự động nâng cấp mô hình đã lỗi thời (404 deprecated) sang gemini-3.7-flash
    db.run(`UPDATE settings SET value = 'gemini-3.7-flash' WHERE key = 'gemini_model' AND (value = 'gemini-1.5-flash' OR value = 'gemini-1.5-pro')`);
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
    },
    // QUẢN LÝ NGƯỜI DÙNG & NHÂN VIÊN (MULTI-USER SAAS)
    getUserById: async (id) => {
        return await dbAsync.get(`SELECT id, username, display_name, discord_channel_id, fb_status, fb_name, role, created_at FROM users WHERE id = ?`, [id]);
    },
    getUserByUsername: async (username) => {
        return await dbAsync.get(`SELECT * FROM users WHERE username = ?`, [username.trim().toLowerCase()]);
    },
    createUser: async ({ username, password, displayName = '', role = 'staff', discordChannelId = '' }) => {
        const u = username.trim().toLowerCase();
        const existing = await dbAsync.getUserByUsername(u);
        if (existing) {
            throw new Error(`Tài khoản "${username}" đã tồn tại trên hệ thống!`);
        }
        const res = await dbAsync.run(`
            INSERT INTO users (username, password, display_name, role, discord_channel_id)
            VALUES (?, ?, ?, ?, ?)
        `, [u, password, displayName || u, role, discordChannelId || '']);
        return await dbAsync.getUserById(res.id);
    },
    updateUser: async (id, fields = {}) => {
        const allowed = ['display_name', 'password', 'discord_channel_id', 'fb_status', 'fb_name', 'fb_cookies', 'role'];
        const setClauses = [];
        const values = [];
        for (const [k, v] of Object.entries(fields)) {
            if (allowed.includes(k)) {
                setClauses.push(`${k} = ?`);
                values.push(v);
            }
        }
        if (setClauses.length === 0) return await dbAsync.getUserById(id);
        values.push(id);
        await dbAsync.run(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, values);
        return await dbAsync.getUserById(id);
    },
    getAllUsers: async () => {
        return await dbAsync.all(`
            SELECT id, username, display_name, discord_channel_id, fb_status, fb_name, role, created_at
            FROM users ORDER BY id ASC
        `);
    },

    // QUẢN LÝ CỤM NHÓM FACEBOOK (GROUP CLUSTERS - CÓ LỌC THEO USER_ID)
    getClusters: async (userId = null) => {
        if (userId) {
            return await dbAsync.all(`
                SELECT c.*, COUNT(cg.group_id) as group_count
                FROM fb_clusters c
                LEFT JOIN fb_cluster_groups cg ON c.id = cg.cluster_id
                WHERE c.user_id = ? OR c.user_id IS NULL
                GROUP BY c.id
                ORDER BY c.name ASC
            `, [userId]);
        }
        return await dbAsync.all(`
            SELECT c.*, COUNT(cg.group_id) as group_count
            FROM fb_clusters c
            LEFT JOIN fb_cluster_groups cg ON c.id = cg.cluster_id
            GROUP BY c.id
            ORDER BY c.name ASC
        `);
    },
    getClusterDetails: async (clusterId) => {
        const cluster = await dbAsync.get(`SELECT * FROM fb_clusters WHERE id = ?`, [clusterId]);
        if (!cluster) return null;
        const groups = await dbAsync.all(`
            SELECT g.* FROM fb_groups g
            JOIN fb_cluster_groups cg ON g.id = cg.group_id
            WHERE cg.cluster_id = ?
            ORDER BY g.name ASC
        `, [clusterId]);
        return { ...cluster, groups, group_ids: (groups || []).map(g => g.id) };
    },
    saveCluster: async ({ id, name, description = '', groupIds = [], group_ids = [], userId = 1 }) => {
        let clusterId = id;
        const finalGroupIds = (Array.isArray(groupIds) && groupIds.length > 0) ? groupIds : (Array.isArray(group_ids) ? group_ids : []);
        if (clusterId) {
            await dbAsync.run(`UPDATE fb_clusters SET name = ?, description = ? WHERE id = ?`, [name.trim(), description.trim(), clusterId]);
        } else {
            const res = await dbAsync.run(`INSERT INTO fb_clusters (name, description, user_id) VALUES (?, ?, ?)`, [name.trim(), description.trim(), userId || 1]);
            clusterId = res.id;
        }
        await dbAsync.run(`DELETE FROM fb_cluster_groups WHERE cluster_id = ?`, [clusterId]);
        if (finalGroupIds.length > 0) {
            for (const gid of finalGroupIds) {
                await dbAsync.run(`INSERT OR IGNORE INTO fb_cluster_groups (cluster_id, group_id) VALUES (?, ?)`, [clusterId, gid]);
            }
        }
        return { id: clusterId, name, description, groupCount: finalGroupIds.length, group_ids: finalGroupIds, user_id: userId };
    },
    deleteCluster: async (clusterId) => {
        await dbAsync.run(`DELETE FROM fb_cluster_groups WHERE cluster_id = ?`, [clusterId]);
        await dbAsync.run(`DELETE FROM fb_clusters WHERE id = ?`, [clusterId]);
        return { success: true };
    },
    getGroupsForCluster: async (clusterId, userId = null) => {
        if (!clusterId || clusterId === 'all' || clusterId === 0) {
            if (userId) {
                return await dbAsync.all(`SELECT * FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id IS NULL)`, [userId]);
            }
            return await dbAsync.all(`SELECT * FROM fb_groups WHERE is_active = 1`);
        }
        return await dbAsync.all(`
            SELECT g.* FROM fb_groups g
            JOIN fb_cluster_groups cg ON g.id = cg.group_id
            WHERE cg.cluster_id = ? AND g.is_active = 1
        `, [clusterId]);
    },
    exportBackup: async () => {
        const settings = await dbAsync.all(`SELECT * FROM settings`);
        const fbGroups = await dbAsync.all(`SELECT name, url, member_count, is_active FROM fb_groups`);
        const zaloGroups = await dbAsync.all(`SELECT name, is_monitored FROM zalo_groups`);
        const fbClusters = await dbAsync.all(`SELECT * FROM fb_clusters`);
        const fbClusterGroups = await dbAsync.all(`SELECT * FROM fb_cluster_groups`);
        return {
            version: '2.2.0',
            exported_at: new Date().toISOString(),
            settings,
            fbGroups,
            zaloGroups,
            fbClusters,
            fbClusterGroups
        };
    },
    importBackup: async (backup) => {
        if (!backup || typeof backup !== 'object') throw new Error('File sao lưu không hợp lệ!');
        let importedSettings = 0;
        let importedFbGroups = 0;
        let importedZaloGroups = 0;

        if (Array.isArray(backup.settings)) {
            for (const s of backup.settings) {
                if (s.key && s.value !== undefined) {
                    await dbAsync.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [s.key, s.value]);
                    importedSettings++;
                }
            }
        }

        if (Array.isArray(backup.fbGroups)) {
            for (const g of backup.fbGroups) {
                if (g.url) {
                    await dbAsync.run(`
                        INSERT INTO fb_groups (name, url, member_count, is_active)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(url) DO UPDATE SET
                            name = excluded.name,
                            member_count = excluded.member_count,
                            is_active = excluded.is_active
                    `, [g.name || 'Nhóm FB', g.url, g.member_count || '', g.is_active !== undefined ? g.is_active : 1]);
                    importedFbGroups++;
                }
            }
        }

        if (Array.isArray(backup.zaloGroups)) {
            for (const zg of backup.zaloGroups) {
                if (zg.name) {
                    await dbAsync.run(`
                        INSERT INTO zalo_groups (name, is_monitored)
                        VALUES (?, ?)
                        ON CONFLICT(name) DO UPDATE SET
                            is_monitored = excluded.is_monitored
                    `, [zg.name, zg.is_monitored !== undefined ? zg.is_monitored : 1]);
                    importedZaloGroups++;
                }
            }
        }

        if (Array.isArray(backup.fbClusters)) {
            for (const c of backup.fbClusters) {
                if (c.name) {
                    await dbAsync.run(`
                        INSERT INTO fb_clusters (id, name, description)
                        VALUES (?, ?, ?)
                        ON CONFLICT(name) DO UPDATE SET
                            description = excluded.description
                    `, [c.id || null, c.name, c.description || '']);
                }
            }
        }

        if (Array.isArray(backup.fbClusterGroups)) {
            for (const cg of backup.fbClusterGroups) {
                if (cg.cluster_id && cg.group_id) {
                    await dbAsync.run(`
                        INSERT OR IGNORE INTO fb_cluster_groups (cluster_id, group_id)
                        VALUES (?, ?)
                    `, [cg.cluster_id, cg.group_id]);
                }
            }
        }

        return { importedSettings, importedFbGroups, importedZaloGroups };
    }
};

module.exports = { db, dbAsync };
