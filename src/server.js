const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const { dbAsync } = require('./db');
const {
    getUserFbStatus,
    saveUserFbCookies,
    disconnectUserFb,
    saveUserScannedGroups,
    loginUserWithCredentials,
    scanUserFbGroups,
    publishPostForUser
} = require('./services/multiFbEngine');
const { getDiscordBotStatus, startDiscordBot, stopDiscordBot } = require('./services/discordEngine');

function getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const k in interfaces) {
        for (const addr of interfaces[k]) {
            if (addr.family === 'IPv4' && !addr.internal) {
                addresses.push(addr.address);
            }
        }
    }
    return addresses;
}

function createServer() {
    const app = express();

    app.use(cors());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Tự động chuyển hướng sang mobile.html nếu truy cập từ trình duyệt điện thoại (iOS / Android)
    app.get('/', (req, res, next) => {
        const ua = req.headers['user-agent'] || '';
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        if (isMobile) {
            return res.redirect('/mobile.html');
        }
        next();
    });

    // Phục vụ giao diện Web tĩnh từ thư mục public
    const publicDir = path.join(__dirname, '..', 'public');
    app.use(express.static(publicDir));
    // Phục vụ thư mục ảnh data/images
    const imagesDir = path.join(__dirname, '..', 'data', 'images');
    app.use('/data/images', express.static(imagesDir));

    // Middleware trích xuất thông tin người dùng
    app.use((req, res, next) => {
        const authHeader = req.headers['authorization'] || '';
        const xUserId = req.headers['x-user-id'] || req.query.user_id;

        let userId = 1; // Mặc định là Admin (ID 1)
        if (xUserId) {
            userId = parseInt(xUserId, 10) || 1;
        } else if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '').trim();
            const parsed = parseInt(token, 10);
            if (!isNaN(parsed)) userId = parsed;
        }

        req.userId = userId;
        next();
    });

    // 1. THÔNG TIN MÁY CHỦ & ĐƯỜNG LINK TRUY CẬP CHO ĐIỆN THOẠI
    app.get('/api/server-info', (req, res) => {
        const port = process.env.PORT || 3000;
        const localIps = getLocalIpAddresses();
        const primaryIp = localIps[0] || 'localhost';

        res.json({
            success: true,
            port: port,
            localIps: localIps,
            accessUrls: {
                desktopWeb: `http://localhost:${port}`,
                mobileWeb: `http://${primaryIp}:${port}/mobile.html`,
                allMobileLinks: localIps.map(ip => `http://${ip}:${port}/mobile.html`)
            }
        });
    });

    // 2. XÁC THỰC TÀI KHOẢN (AUTH)
    app.post('/api/auth/login', async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ success: false, message: 'Vui lòng nhập tên đăng nhập và mật khẩu!' });
            }

            const user = await dbAsync.getUserByUsername(username);
            if (!user) {
                return res.status(401).json({ success: false, message: 'Tài khoản không tồn tại trên hệ thống!' });
            }

            if (user.password !== password) {
                return res.status(401).json({ success: false, message: 'Mật khẩu không chính xác!' });
            }

            const safeUser = {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                role: user.role,
                discordChannelId: user.discord_channel_id,
                fbStatus: user.fb_status,
                fbName: user.fb_name
            };

            res.json({
                success: true,
                token: String(user.id),
                user: safeUser
            });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.post('/api/auth/register', async (req, res) => {
        try {
            const { username, password, displayName, discordChannelId } = req.body;
            if (!username || !password) {
                return res.status(400).json({ success: false, message: 'Tên đăng nhập và mật khẩu là bắt buộc!' });
            }

            const newUser = await dbAsync.createUser({
                username,
                password,
                displayName: displayName || username,
                discordChannelId: discordChannelId || ''
            });

            res.json({
                success: true,
                token: String(newUser.id),
                user: newUser
            });
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    app.get('/api/auth/me', async (req, res) => {
        try {
            const user = await dbAsync.getUserById(req.userId);
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            res.json({ success: true, user });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.get('/api/users', async (req, res) => {
        try {
            const users = await dbAsync.getAllUsers();
            res.json({ success: true, users });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.post('/api/users', async (req, res) => {
        try {
            const { username, password, displayName, discordChannelId, role } = req.body;
            if (!username || !password) {
                return res.status(400).json({ success: false, message: 'Tên đăng nhập và mật khẩu là bắt buộc!' });
            }
            const newUser = await dbAsync.createUser({ username, password, displayName, discordChannelId, role: role || 'staff' });
            res.json({ success: true, user: newUser });
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    app.put('/api/users/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const updated = await dbAsync.updateUser(id, req.body);
            res.json({ success: true, user: updated });
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    app.delete('/api/users/:id', async (req, res) => {
        try {
            const { id } = req.params;
            await dbAsync.deleteUser(id);
            res.json({ success: true });
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    // 3. QUẢN LÝ PHIÊN FACEBOOK CỦA TỪNG NHÂN VIÊN
    app.get('/api/fb/status', async (req, res) => {
        try {
            const status = await getUserFbStatus(req.userId);
            res.json({ success: true, ...status });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.post('/api/fb/login-credentials', async (req, res) => {
        try {
            const { email, password, twoFactorCode, accountName } = req.body;
            const result = await loginUserWithCredentials(req.userId, email, password, twoFactorCode, accountName);
            if (!result.success) {
                return res.status(result.require2FA ? 200 : 400).json(result);
            }
            res.json(result);
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    app.post('/api/fb/scan-groups', async (req, res) => {
        try {
            const result = await scanUserFbGroups(req.userId);
            res.json(result);
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    app.post('/api/fb/save-cookies', async (req, res) => {
        try {
            const { cookies, accountName } = req.body;
            const result = await saveUserFbCookies(req.userId, cookies, accountName);
            res.json(result);
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    app.post('/api/fb/disconnect', async (req, res) => {
        try {
            const result = await disconnectUserFb(req.userId);
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // 4. QUẢN LÝ NHÓM FACEBOOK (LỌC THEO USER_ID)
    app.get('/api/fb/groups', async (req, res) => {
        try {
            const groups = await dbAsync.all(`
                SELECT * FROM fb_groups 
                WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)
                ORDER BY name ASC
            `, [req.userId]);
            res.json({ success: true, groups });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.post('/api/fb/save-scanned-groups', async (req, res) => {
        try {
            const { groups } = req.body;
            const result = await saveUserScannedGroups(req.userId, groups);
            res.json({ success: true, ...result });
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    app.post('/api/fb/toggle-group', async (req, res) => {
        try {
            const { id } = req.body;
            const grp = await dbAsync.get(`SELECT * FROM fb_groups WHERE id = ?`, [id]);
            if (!grp) return res.status(404).json({ success: false, message: 'Nhóm không tồn tại' });
            const newStatus = grp.is_active ? 0 : 1;
            await dbAsync.run(`UPDATE fb_groups SET is_active = ? WHERE id = ?`, [newStatus, id]);
            res.json({ success: true, is_active: newStatus });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.delete('/api/fb/groups/:id', async (req, res) => {
        try {
            const { id } = req.params;
            await dbAsync.run(`DELETE FROM fb_cluster_groups WHERE group_id = ?`, [id]);
            await dbAsync.run(`DELETE FROM fb_groups WHERE id = ?`, [id]);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // 5. CỤM NHÓM FACEBOOK (GROUP CLUSTERS - LỌC THEO USER_ID)
    app.get('/api/clusters', async (req, res) => {
        try {
            const clusters = await dbAsync.getClusters(req.userId);
            res.json({ success: true, clusters });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.get('/api/clusters/:id', async (req, res) => {
        try {
            const details = await dbAsync.getClusterDetails(req.params.id);
            if (!details) return res.status(404).json({ success: false, message: 'Cụm nhóm không tồn tại' });
            res.json({ success: true, cluster: details });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.post('/api/clusters', async (req, res) => {
        try {
            const { id, name, description, group_ids, groupIds } = req.body;
            if (!name || !name.trim()) {
                return res.status(400).json({ success: false, message: 'Tên cụm nhóm là bắt buộc!' });
            }
            const saved = await dbAsync.saveCluster({
                id,
                name: name.trim(),
                description: description || '',
                groupIds: groupIds || group_ids || [],
                userId: req.userId
            });
            res.json({ success: true, cluster: saved });
        } catch (e) {
            res.status(400).json({ success: false, message: e.message });
        }
    });

    app.delete('/api/clusters/:id', async (req, res) => {
        try {
            await dbAsync.deleteCluster(req.params.id);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // 6. HÀNG ĐỢI BÀI VIẾT (POSTS - LỌC THEO USER_ID)
    app.get('/api/posts', async (req, res) => {
        try {
            const status = req.query.status;
            let query = `SELECT * FROM posts WHERE (user_id = ? OR user_id = 1 OR user_id IS NULL)`;
            const params = [req.userId];

            if (status && status !== 'all') {
                query += ` AND status = ?`;
                params.push(status);
            }
            query += ` ORDER BY id DESC LIMIT 100`;

            const rows = await dbAsync.all(query, params);
            const parsed = rows.map(r => {
                let images = [];
                try {
                    images = r.images ? JSON.parse(r.images) : [];
                    if (!Array.isArray(images)) images = [images];
                } catch (e) {
                    images = r.images ? [r.images] : [];
                }

                let post_links = [];
                try {
                    post_links = r.post_links ? JSON.parse(r.post_links) : [];
                    if (!Array.isArray(post_links)) post_links = [];
                } catch (e) {
                    post_links = [];
                }

                return {
                    ...r,
                    images,
                    post_links
                };
            });

            res.json({ success: true, posts: parsed });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.post('/api/posts/:id/approve', async (req, res) => {
        try {
            const { target_cluster_id, rewritten_text } = req.body;
            const postId = req.params.id;

            let query = `UPDATE posts SET status = 'approved'`;
            const params = [];

            if (target_cluster_id !== undefined) {
                query += `, target_cluster_id = ?`;
                params.push(target_cluster_id);
            }
            if (rewritten_text !== undefined) {
                query += `, rewritten_text = ?`;
                params.push(rewritten_text);
            }

            query += ` WHERE id = ?`;
            params.push(postId);

            await dbAsync.run(query, params);
            res.json({ success: true, message: `Đã duyệt bài viết #${postId} sang trạng thái sẵn sàng đăng!` });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.post('/api/posts/:id/publish', async (req, res) => {
        try {
            const { clusterId } = req.body;
            const postId = req.params.id;
            const result = await publishPostForUser(req.userId, postId, clusterId);
            res.json({ success: true, ...result });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.delete('/api/posts/:id', async (req, res) => {
        try {
            await dbAsync.run(`DELETE FROM posts WHERE id = ?`, [req.params.id]);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.delete('/api/posts', async (req, res) => {
        try {
            const status = req.query.status;
            if (status && status !== 'all') {
                await dbAsync.run(`DELETE FROM posts WHERE status = ? AND (user_id = ? OR user_id IS NULL)`, [status, req.userId]);
            } else {
                await dbAsync.run(`DELETE FROM posts WHERE (user_id = ? OR user_id IS NULL)`, [req.userId]);
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    // 7. CÀI ĐẶT & DISCORD BOT
    app.get('/api/settings', async (req, res) => {
        try {
            const rows = await dbAsync.all(`SELECT key, value FROM settings`);
            const settings = {};
            for (const r of rows) settings[r.key] = r.value;
            res.json({ success: true, settings });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.post('/api/settings', async (req, res) => {
        try {
            const newSettings = req.body;
            for (const [k, v] of Object.entries(newSettings)) {
                await dbAsync.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [k, String(v)]);
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.get('/api/discord/status', (req, res) => {
        try {
            const status = getDiscordBotStatus();
            res.json({ success: true, ...status });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    app.get('/api/logs', async (req, res) => {
        try {
            const logs = await dbAsync.all(`SELECT * FROM logs ORDER BY id DESC LIMIT 50`);
            res.json({ success: true, logs });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });

    return app;
}

function startServer(port = 3000) {
    const app = createServer();
    const serverPort = process.env.PORT || port;
    const server = app.listen(serverPort, '0.0.0.0', () => {
        const localIps = getLocalIpAddresses();
        const primaryIp = localIps[0] || 'localhost';
        console.log(`========================================================`);
        console.log(`🚀 [PostHub SaaS Web Server] Đang chạy tại cổng ${serverPort}`);
        console.log(`💻 Mở trên máy tính:   http://localhost:${serverPort}`);
        console.log(`📱 Mở trên điện thoại: http://${primaryIp}:${serverPort}/mobile.html`);
        console.log(`========================================================`);
    });
    return { app, server };
}

// Nếu chạy trực tiếp bằng node src/server.js
if (require.main === module) {
    startServer(process.env.PORT || 3000);
}

module.exports = { createServer, startServer, getLocalIpAddresses };
