const express = require('express');
const router = express.Router();
const { dbAsync } = require('../db');
const { handleIncomingZaloMessage } = require('../services/zaloReceiver');
const { rewriteWithGemini, testGemini } = require('../services/gemini');
const { publishPost } = require('../services/fbPoster');
const { addClient } = require('../services/events');

// --- SSE Realtime Stream ---
router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    addClient(res);
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);
});

// --- Hệ thống & Thống kê ---
router.get('/status', async (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const msgToday = await dbAsync.get(`SELECT COUNT(*) as count FROM messages WHERE date(created_at) = date('now')`);
        const postsToday = await dbAsync.get(`SELECT COUNT(*) as count FROM posts WHERE date(created_at) = date('now')`);
        const pendingCount = await dbAsync.get(`SELECT COUNT(*) as count FROM posts WHERE status = 'pending'`);
        const postedCount = await dbAsync.get(`SELECT COUNT(*) as count FROM posts WHERE status = 'posted'`);
        const autoSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);

        res.json({
            success: true,
            stats: {
                messagesToday: msgToday?.count || 0,
                postsToday: postsToday?.count || 0,
                pendingPosts: pendingCount?.count || 0,
                postedPosts: postedCount?.count || 0,
                autoPostEnabled: autoSetting?.value === '1'
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Cài đặt (Settings) ---
router.get('/settings', async (req, res) => {
    try {
        const rows = await dbAsync.all(`SELECT key, value FROM settings`);
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/settings', async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings) return res.status(400).json({ success: false, error: 'Thiếu dữ liệu cài đặt' });

        for (const [key, val] of Object.entries(settings)) {
            await dbAsync.run(
                `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
                [key, String(val), String(val)]
            );
        }
        await dbAsync.log('info', 'Đã cập nhật cài đặt hệ thống.');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Webhook tiếp nhận tin nhắn từ Zalo Web Userscript ---
router.post('/zalo/webhook', async (req, res) => {
    try {
        const { groupName, sender, text, images } = req.body;
        const result = await handleIncomingZaloMessage({ groupName, sender, text, images });
        res.json({ success: true, result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Quản lý Nhóm Zalo ---
router.get('/zalo/groups', async (req, res) => {
    try {
        const groups = await dbAsync.all(`SELECT * FROM zalo_groups ORDER BY id DESC`);
        res.json({ success: true, groups });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/zalo/groups', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ success: false, error: 'Tên nhóm không được để trống' });
        await dbAsync.run(`INSERT OR IGNORE INTO zalo_groups (name, is_monitored) VALUES (?, 1)`, [name.trim()]);
        await dbAsync.log('info', `Đã thêm nhóm Zalo theo dõi: ${name.trim()}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/zalo/groups/:id', async (req, res) => {
    try {
        await dbAsync.run(`DELETE FROM zalo_groups WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Quản lý Nhóm Facebook ---
router.get('/fb/groups', async (req, res) => {
    try {
        const groups = await dbAsync.all(`SELECT * FROM fb_groups ORDER BY id DESC`);
        res.json({ success: true, groups });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/fb/groups', async (req, res) => {
    try {
        const { name, url } = req.body;
        if (!name?.trim() || !url?.trim()) {
            return res.status(400).json({ success: false, error: 'Vui lòng nhập đủ tên nhóm và link Facebook' });
        }
        await dbAsync.run(`INSERT OR IGNORE INTO fb_groups (name, url, is_active) VALUES (?, ?, 1)`, [name.trim(), url.trim()]);
        await dbAsync.log('info', `Đã thêm nhóm Facebook: ${name.trim()}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/fb/groups/:id/toggle', async (req, res) => {
    try {
        await dbAsync.run(`UPDATE fb_groups SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/fb/groups/:id', async (req, res) => {
    try {
        await dbAsync.run(`DELETE FROM fb_groups WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Quản lý Bài đăng (Posts Queue) ---
router.get('/posts', async (req, res) => {
    try {
        const posts = await dbAsync.all(`SELECT * FROM posts ORDER BY id DESC LIMIT 100`);
        res.json({ success: true, posts });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/posts/:id', async (req, res) => {
    try {
        const { rewritten_text, status } = req.body;
        await dbAsync.run(
            `UPDATE posts SET rewritten_text = COALESCE(?, rewritten_text), status = COALESCE(?, status) WHERE id = ?`,
            [rewritten_text, status, req.params.id]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/posts/:id/publish', async (req, res) => {
    try {
        const result = await publishPost(req.params.id);
        res.json({ success: true, result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/posts/:id', async (req, res) => {
    try {
        await dbAsync.run(`DELETE FROM posts WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Kiểm tra Gemini AI ---
router.post('/ai/test', async (req, res) => {
    try {
        const { apiKey, promptTemplate, model } = req.body;
        const result = await testGemini(apiKey, promptTemplate, model);
        res.json({ success: true, result });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// --- Nhật ký hoạt động ---
router.get('/logs', async (req, res) => {
    try {
        const logs = await dbAsync.all(`SELECT * FROM logs ORDER BY id DESC LIMIT 100`);
        res.json({ success: true, logs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
