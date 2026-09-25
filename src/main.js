const { app, BrowserWindow, ipcMain, session, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { dbAsync } = require('./db');
const { testGemini, rewriteWithGemini } = require('./services/gemini');
const { processZaloMessage, setEventBroadcaster } = require('./services/zaloEngine');
const {
    handleScannedGroups,
    publishPost,
    startFbPostWorker,
    setFbEventBroadcaster
} = require('./services/fbEngine');
const { processHistoricalZaloMessages } = require('./services/historyScanner');
const {
    launchChromeGemini,
    isChromeDebuggingActive,
    getActiveGeminiTabInfo,
    sendPromptToChromeGemini
} = require('./services/chromeGemini');
const {
    startDiscordBot,
    stopDiscordBot,
    getDiscordBotStatus,
    setDiscordEventBroadcaster,
    sendDiscordTestMessage
} = require('./services/discordEngine');
const { startServer, getLocalIpAddresses } = require('./server');

dotenv.config();

// Ẩn các cờ tự động hóa Chromium để vượt qua cơ chế kiểm tra bảo mật Google
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

let mainWindow = null;
let tray = null;
let isQuitting = false;

function showNativeNotification(title, body) {
    try {
        if (Notification.isSupported()) {
            new Notification({
                title: title || 'PostHub PC',
                body: body || ''
            }).show();
        }
    } catch (e) {
        console.error('Lỗi hiển thị notification:', e);
    }
}

function setupTray() {
    if (tray) return;

    const iconPath = path.join(__dirname, '..', 'public', 'assets', 'icon.png');
    let trayIcon;
    if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
    } else {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('PostHub PC - Tự Động Hóa Zalo sang Facebook');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Mở Giao Diện PostHub',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Thoát Hoàn Toàn',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1366,
        height: 860,
        minWidth: 1024,
        minHeight: 700,
        title: 'PostHub - Tự Động Hóa Zalo sang Facebook (Desktop)',
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, 'preloads', 'appPreload.js'),
            webviewTag: true,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            spellcheck: false
        }
    });

    // Ẩn thanh menu mặc định để giao diện hiện đại, sạch sẽ
    mainWindow.setMenuBarVisibility(false);

    // Nạp giao diện chính
    mainWindow.loadFile(path.join(__dirname, '..', 'public', 'index.html'));

    // Bắt sự kiện đóng cửa sổ -> Thu nhỏ xuống System Tray thay vì thoát app
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            showNativeNotification(
                'PostHub PC đang chạy ngầm',
                'Ứng dụng đã thu nhỏ xuống khay hệ thống cạnh đồng hồ và vẫn tự động hóa 24/7.'
            );
            return false;
        }
    });

    // Cấu hình User-Agent Desktop chuẩn cho Webview Zalo & Facebook
    const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const firefoxUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0';
    
    const zaloSession = session.fromPartition('persist:zalo');
    zaloSession.setUserAgent(desktopUA);

    const fbSession = session.fromPartition('persist:fb');
    fbSession.setUserAgent(desktopUA);

    const geminiSession = session.fromPartition('persist:gemini');
    geminiSession.setUserAgent(firefoxUA);

    // Can thiệp Request Headers để vượt qua cơ chế chặn "This browser or app may not be secure" của Google
    geminiSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const url = details.url.toLowerCase();
        if (url.includes('google.com') || url.includes('google.com.vn') || url.includes('gstatic.com')) {
            details.requestHeaders['User-Agent'] = firefoxUA;
            delete details.requestHeaders['Sec-Ch-Ua'];
            delete details.requestHeaders['Sec-Ch-Ua-Mobile'];
            delete details.requestHeaders['Sec-Ch-Ua-Platform'];
            delete details.requestHeaders['Sec-Ch-Ua-Model'];
            delete details.requestHeaders['sec-ch-ua'];
            delete details.requestHeaders['sec-ch-ua-mobile'];
            delete details.requestHeaders['sec-ch-ua-platform'];
        }
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // Kênh phát sự kiện từ Backend sang UI
    const broadcast = (channel, data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(channel, data);
        }
        if (channel === 'new-zalo-message') {
            showNativeNotification(
                `Tin Zalo mới [${data.groupName}]`,
                `${data.sender}: ${data.content ? data.content.substring(0, 60) : '[Hình ảnh]'}`
            );
        } else if (channel === 'post-published') {
            showNativeNotification(
                'Xuất bản Facebook thành công!',
                `Bài viết #${data.id} đã được đăng lên Facebook.`
            );
        }
    };

    setEventBroadcaster(broadcast);
    setFbEventBroadcaster(broadcast);
    setDiscordEventBroadcaster(broadcast);
    dbAsync.setLogListener((log) => broadcast('new-log-entry', log));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    dbAsync.log('info', 'Ứng dụng PostHub Desktop đã khởi chạy thành công.');
}

// Đảm bảo chỉ chạy 1 phiên bản duy nhất (Single Instance Lock)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Khởi chạy vòng đời Electron
    app.whenReady().then(() => {
        createWindow();
        setupTray();
        startFbPostWorker();

        // Khởi động Web Server SaaS cho điện thoại và trình duyệt
        try {
            startServer(process.env.PORT || 3000);
        } catch (serverErr) {
            console.error('[Web Server SaaS] Lỗi khởi động:', serverErr.message);
        }

        // Tự động khởi động Discord Bot nếu đã bật trước đó
        setTimeout(async () => {
            try {
                const botEnabledRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_bot_enabled'`);
                if (botEnabledRow?.value === '1') {
                    const tokenRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_bot_token'`);
                    const channelRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_channel_id'`);
                    const debounceRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_debounce_seconds'`);
                    if (tokenRow?.value && channelRow?.value) {
                        await startDiscordBot({
                            token: tokenRow.value,
                            channelId: channelRow.value,
                            debounceSeconds: parseInt(debounceRow?.value || '60', 10)
                        });
                    }
                }
            } catch (err) {
                console.warn('[Discord Bot] Lỗi tự khởi động:', err.message);
            }
        }, 3000);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
            else if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            }
        });
    });
}

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting) app.quit();
});

// ==========================================
// ĐĂNG KÝ CÁC IPC HANDLERS GIAO TIẾP VỚI UI
// ==========================================

// 0. Thông tin Web Server SaaS & Link Mobile
ipcMain.handle('get-server-info', async () => {
    const port = process.env.PORT || 3000;
    const localIps = getLocalIpAddresses();
    return {
        success: true,
        port: port,
        localIps: localIps,
        mobileUrl: `http://${localIps[0] || 'localhost'}:${port}/mobile.html`,
        desktopWebUrl: `http://localhost:${port}`
    };
});

// 1. Trạng thái & Thống kê
ipcMain.handle('get-status', async () => {
    try {
        const msgToday = await dbAsync.get(`SELECT COUNT(*) as count FROM messages WHERE date(created_at) = date('now')`);
        const postsToday = await dbAsync.get(`SELECT COUNT(*) as count FROM posts WHERE date(created_at) = date('now')`);
        const pendingCount = await dbAsync.get(`SELECT COUNT(*) as count FROM posts WHERE status = 'pending'`);
        const postedCount = await dbAsync.get(`SELECT COUNT(*) as count FROM posts WHERE status = 'posted'`);
        const autoSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);

        return {
            success: true,
            stats: {
                messagesToday: msgToday?.count || 0,
                postsToday: postsToday?.count || 0,
                pendingPosts: pendingCount?.count || 0,
                postedPosts: postedCount?.count || 0,
                autoPostEnabled: autoSetting?.value === '1'
            }
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 2. Cài đặt hệ thống
ipcMain.handle('get-settings', async () => {
    try {
        const rows = await dbAsync.all(`SELECT key, value FROM settings`);
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        return { success: true, settings };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-settings', async (event, settings) => {
    try {
        for (const [key, val] of Object.entries(settings)) {
            await dbAsync.run(
                `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
                [key, String(val), String(val)]
            );
        }
        await dbAsync.log('info', 'Đã lưu cấu hình cài đặt hệ thống.');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 3. Nhóm Zalo
ipcMain.handle('get-zalo-groups', async () => {
    try {
        const groups = await dbAsync.all(`SELECT * FROM zalo_groups ORDER BY id DESC`);
        return { success: true, groups };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('add-zalo-group', async (event, name) => {
    try {
        if (!name?.trim()) throw new Error('Tên nhóm không được để trống.');
        await dbAsync.run(`INSERT OR IGNORE INTO zalo_groups (name, is_monitored) VALUES (?, 1)`, [name.trim()]);
        await dbAsync.log('info', `Đã thêm nhóm Zalo theo dõi: ${name.trim()}`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('add-zalo-groups-bulk', async (event, groups) => {
    try {
        if (!Array.isArray(groups) || groups.length === 0) return { success: true, count: 0, added: 0 };
        let added = 0;
        for (const g of groups) {
            const name = (typeof g === 'string' ? g : g.name)?.trim();
            if (!name) continue;
            const res = await dbAsync.run(
                `INSERT INTO zalo_groups (name, is_monitored) VALUES (?, 1)
                 ON CONFLICT(name) DO NOTHING`,
                [name]
            );
            if (res.changes > 0) added++;
        }
        await dbAsync.log('info', `Đã quét và nạp ${groups.length} nhóm Zalo vào danh sách theo dõi (Thêm mới: ${added}).`);
        return { success: true, count: groups.length, added };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('process-zalo-history', async (event, payload) => {
    try {
        const messages = payload?.messages || [];
        const options = payload?.options || {};
        return await processHistoricalZaloMessages(messages, options);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-zalo-group', async (event, id) => {
    try {
        await dbAsync.run(`DELETE FROM zalo_groups WHERE id = ?`, [id]);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('clear-all-zalo-groups', async () => {
    try {
        await dbAsync.run(`DELETE FROM zalo_groups`);
        await dbAsync.log('info', 'Đã xóa toàn bộ danh sách nhóm Zalo.');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('toggle-zalo-group', async (event, id) => {
    try {
        await dbAsync.run(`UPDATE zalo_groups SET is_monitored = CASE WHEN is_monitored = 1 THEN 0 ELSE 1 END WHERE id = ?`, [id]);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('toggle-all-zalo-groups', async (event, isMonitored) => {
    try {
        await dbAsync.run(`UPDATE zalo_groups SET is_monitored = ?`, [isMonitored ? 1 : 0]);
        await dbAsync.log('info', `Đã ${isMonitored ? 'BẬT' : 'TẮT'} theo dõi toàn bộ nhóm Zalo.`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 4. Nhóm Facebook
ipcMain.handle('get-fb-groups', async () => {
    try {
        const groups = await dbAsync.all(`SELECT * FROM fb_groups ORDER BY id DESC`);
        return { success: true, groups };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('add-fb-group', async (event, { name, url }) => {
    try {
        if (!name?.trim() || !url?.trim()) throw new Error('Vui lòng điền đủ tên và link nhóm.');
        await dbAsync.run(`INSERT OR IGNORE INTO fb_groups (name, url, is_active) VALUES (?, ?, 1)`, [name.trim(), url.trim()]);
        await dbAsync.log('info', `Đã thêm nhóm Facebook: ${name.trim()}`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-fb-group', async (event, id) => {
    try {
        await dbAsync.run(`DELETE FROM fb_cluster_groups WHERE group_id = ?`, [id]);
        await dbAsync.run(`DELETE FROM fb_groups WHERE id = ?`, [id]);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('toggle-fb-group', async (event, id) => {
    try {
        await dbAsync.run(`UPDATE fb_groups SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`, [id]);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('toggle-all-fb-groups', async (event, isActive) => {
    try {
        await dbAsync.run(`UPDATE fb_groups SET is_active = ?`, [isActive ? 1 : 0]);
        await dbAsync.log('info', `Đã ${isActive ? 'BẬT' : 'TẮT'} đăng bài cho toàn bộ nhóm Facebook.`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 4.1 Quản Lý Cụm Nhóm Facebook (Group Clusters)
ipcMain.handle('get-clusters', async () => {
    try {
        const clusters = await dbAsync.getClusters();
        return { success: true, clusters };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-cluster-details', async (event, clusterId) => {
    try {
        const cluster = await dbAsync.getClusterDetails(clusterId);
        return { success: true, cluster };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-cluster', async (event, data) => {
    try {
        const result = await dbAsync.saveCluster(data);
        await dbAsync.log('info', `Đã lưu Cụm Nhóm [${data.name}] thành công (${data.groupIds?.length || 0} nhóm).`);
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-cluster', async (event, clusterId) => {
    try {
        await dbAsync.deleteCluster(clusterId);
        await dbAsync.log('info', `Đã xóa Cụm Nhóm ID: ${clusterId}.`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 5. Bài viết & Hàng đợi
ipcMain.handle('get-posts', async () => {
    try {
        const posts = await dbAsync.all(`
            SELECT p.*, m.sender, COALESCE(p.images, m.images) as images, c.name as cluster_name 
            FROM posts p 
            LEFT JOIN messages m ON p.message_id = m.id 
            LEFT JOIN fb_clusters c ON p.target_cluster_id = c.id
            ORDER BY p.id DESC LIMIT 150
        `);
        return { success: true, posts };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('update-post', async (event, { id, text, status }) => {
    try {
        await dbAsync.run(
            `UPDATE posts SET rewritten_text = COALESCE(?, rewritten_text), status = COALESCE(?, status) WHERE id = ?`,
            [text, status, id]
        );
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('approve-post', async (event, data) => {
    try {
        const id = (typeof data === 'object') ? data.id : data;
        const clusterId = (typeof data === 'object') ? data.clusterId : null;
        if (clusterId && clusterId !== 'all') {
            await dbAsync.run(`UPDATE posts SET status = 'approved', target_cluster_id = ? WHERE id = ?`, [clusterId, id]);
        } else {
            await dbAsync.run(`UPDATE posts SET status = 'approved' WHERE id = ?`, [id]);
        }
        await dbAsync.log('info', `Đã duyệt bài viết #${id} sang trạng thái sẵn sàng đăng${clusterId ? ` (Cụm ID: ${clusterId})` : ''}.`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('approve-all-pending-posts', async () => {
    try {
        await dbAsync.run(`UPDATE posts SET status = 'approved' WHERE status = 'pending'`);
        await dbAsync.log('info', 'Đã duyệt tất cả các bài viết chờ sang trạng thái sẵn sàng đăng.');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('publish-post', async (event, data) => {
    try {
        const id = (typeof data === 'object') ? data.id : data;
        const clusterId = (typeof data === 'object') ? data.clusterId : null;
        const result = await publishPost(id, clusterId);
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('delete-post', async (event, id) => {
    try {
        await dbAsync.run(`DELETE FROM posts WHERE id = ?`, [id]);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('clear-all-posts', async (event, statusFilter) => {
    try {
        if (statusFilter && statusFilter !== 'all') {
            await dbAsync.run(`DELETE FROM posts WHERE status = ?`, [statusFilter]);
            await dbAsync.log('info', `Đã xóa các bài viết trong bảng tin có trạng thái: ${statusFilter}.`);
        } else {
            await dbAsync.run(`DELETE FROM posts`);
            await dbAsync.log('info', 'Đã xóa toàn bộ danh sách bài viết trong bảng tin duyệt (Giữ nguyên các nhóm Zalo & FB).');
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('re-rewrite-post', async (event, id) => {
    try {
        const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [id]);
        if (!post) throw new Error('Không tìm thấy bài viết');
        const originalText = post.original_text || post.rewritten_text || '';
        if (!originalText) throw new Error('Bài viết không có nội dung gốc');
        const newText = await rewriteWithGemini(originalText, post.sender, post.group_name);
        await dbAsync.run(`UPDATE posts SET rewritten_text = ? WHERE id = ?`, [newText, id]);
        await dbAsync.log('info', `Đã dùng Gemini AI viết lại bài viết #${id}.`);
        return { success: true, rewritten_text: newText };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 6. Kiểm tra AI
ipcMain.handle('test-ai', async (event, { apiKey, promptTemplate, model }) => {
    try {
        const result = await testGemini(apiKey, promptTemplate, model);
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 6b. Quản lý & Tự động hóa Google Chrome Gemini
ipcMain.handle('launch-chrome-gemini', async () => {
    try {
        const res = await launchChromeGemini();
        return res;
    } catch (e) {
        return { success: false, message: e.message };
    }
});

ipcMain.handle('check-chrome-gemini', async () => {
    try {
        const res = await isChromeDebuggingActive();
        return { success: true, active: res.active, browser: res.browser };
    } catch (e) {
        return { success: false, active: false, error: e.message };
    }
});

ipcMain.handle('get-active-gemini-url', async () => {
    try {
        const res = await getActiveGeminiTabInfo();
        return res;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('test-chrome-gemini', async (event, payload) => {
    try {
        let prompt = '';
        let targetUrl = null;
        if (typeof payload === 'string') {
            prompt = payload;
        } else if (payload && typeof payload === 'object') {
            prompt = payload.prompt;
            targetUrl = payload.targetUrl;
        }

        if (!targetUrl) {
            const urlRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_conversation_url'`);
            targetUrl = urlRow?.value?.trim() || null;
        }

        const testPrompt = prompt || 'Cho thuê căn hộ studio 35m2 full nội thất view Landmark 81 Bình Thạnh giá 7.5 triệu/tháng liên hệ 0901234567';
        const res = await sendPromptToChromeGemini(testPrompt, undefined, targetUrl);

        if (res && res.success && res.finalUrl && (res.finalUrl.includes('/app/') || res.finalUrl.includes('/gem/')) && res.finalUrl !== targetUrl) {
            await dbAsync.run(`UPDATE settings SET value = ? WHERE key = 'gemini_conversation_url'`, [res.finalUrl]);
        }
        return res;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 6.1 Bot Discord
ipcMain.handle('start-discord-bot', async (event, { token, channelId, debounceSeconds }) => {
    try {
        if (token) await dbAsync.run(`UPDATE settings SET value = ? WHERE key = 'discord_bot_token'`, [token]);
        if (channelId) await dbAsync.run(`UPDATE settings SET value = ? WHERE key = 'discord_channel_id'`, [channelId]);
        if (debounceSeconds) await dbAsync.run(`UPDATE settings SET value = ? WHERE key = 'discord_debounce_seconds'`, [String(debounceSeconds)]);
        await dbAsync.run(`UPDATE settings SET value = '1' WHERE key = 'discord_bot_enabled'`);

        const res = await startDiscordBot({ token, channelId, debounceSeconds });
        return { success: true, botName: res.botName };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('stop-discord-bot', async () => {
    try {
        await stopDiscordBot();
        await dbAsync.run(`UPDATE settings SET value = '0' WHERE key = 'discord_bot_enabled'`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-discord-status', async () => {
    try {
        const status = getDiscordBotStatus();
        return { success: true, status };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('send-discord-test-msg', async (event, text) => {
    try {
        const res = await sendDiscordTestMessage(text);
        return res;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 6.2 Kiểm tra toàn diện hệ thống & API (System Health Check)
ipcMain.handle('get-system-health', async () => {
    try {
        // 1. Chrome Gemini Web
        let chromeActive = false;
        let chromeBrowser = null;
        let geminiTabUrl = null;
        try {
            const chRes = await isChromeDebuggingActive();
            chromeActive = !!chRes.active;
            chromeBrowser = chRes.browser || null;
            if (chromeActive) {
                const tabRes = await getActiveGeminiTabInfo();
                if (tabRes && tabRes.success) {
                    geminiTabUrl = tabRes.url;
                }
            }
        } catch (e) {}

        // 2. Discord Bot
        const discordStatus = getDiscordBotStatus();

        // 3. Facebook Groups & Session
        const totalFb = await dbAsync.get(`SELECT COUNT(*) as c FROM fb_groups`);
        const activeFb = await dbAsync.get(`SELECT COUNT(*) as c FROM fb_groups WHERE is_active = 1`);

        // 4. Posts Queue
        const pendingPosts = await dbAsync.get(`SELECT COUNT(*) as c FROM posts WHERE status = 'pending'`);
        const postedPosts = await dbAsync.get(`SELECT COUNT(*) as c FROM posts WHERE status = 'posted'`);
        const failedPosts = await dbAsync.get(`SELECT COUNT(*) as c FROM posts WHERE status = 'failed'`);

        // 5. System settings
        const autoPost = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);
        const stopFlag = await dbAsync.get(`SELECT value FROM settings WHERE key = 'emergency_stop'`);

        return {
            success: true,
            health: {
                timestamp: new Date().toISOString(),
                chrome: {
                    active: chromeActive,
                    browser: chromeBrowser,
                    geminiTabUrl: geminiTabUrl
                },
                discord: discordStatus,
                facebook: {
                    totalGroups: totalFb?.c || 0,
                    activeGroups: activeFb?.c || 0
                },
                queue: {
                    pending: pendingPosts?.c || 0,
                    posted: postedPosts?.c || 0,
                    failed: failedPosts?.c || 0
                },
                settings: {
                    autoPostEnabled: autoPost?.value === '1',
                    emergencyStop: stopFlag?.value === '1'
                }
            }
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 7. Nhật ký
ipcMain.handle('get-logs', async () => {
    try {
        const logs = await dbAsync.all(`SELECT * FROM logs ORDER BY id DESC LIMIT 150`);
        return { success: true, logs };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('add-log', async (event, { level, message }) => {
    try {
        await dbAsync.log(level || 'info', message || '');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// 8. Sao lưu & Phục hồi dữ liệu
ipcMain.handle('export-backup', async () => {
    try {
        const data = await dbAsync.exportBackup();
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('import-backup', async (event, backupData) => {
    try {
        const stats = await dbAsync.importBackup(backupData);
        await dbAsync.log('info', `Đã phục hồi dữ liệu: ${stats.importedSettings} cài đặt, ${stats.importedFbGroups} nhóm FB, ${stats.importedZaloGroups} nhóm Zalo.`);
        return { success: true, stats };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('show-notification', async (event, { title, body }) => {
    showNativeNotification(title, body);
    return { success: true };
});

// 8.1 Chọn & Mở Thư Mục Cục Bộ
ipcMain.handle('select-directory', async (event, defaultPath) => {
    try {
        const { dialog } = require('electron');
        const res = await dialog.showOpenDialog(mainWindow, {
            title: 'Chọn thư mục lưu ảnh Discord & Giải nén zip',
            defaultPath: defaultPath || undefined,
            properties: ['openDirectory', 'createDirectory']
        });
        if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
            return { canceled: true };
        }
        return { canceled: false, path: res.filePaths[0] };
    } catch (e) {
        return { canceled: true, error: e.message };
    }
});

ipcMain.handle('open-directory', async (event, dirPath) => {
    try {
        const { shell } = require('electron');
        let target = dirPath;
        if (!target) {
            target = path.join(__dirname, '..', 'data', 'images');
        }
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }
        await shell.openPath(target);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// ==============================================================
// XỬ LÝ SỰ KIỆN TỪ WEBVIEW ZALO VÀ FACEBOOK QUA IPC TỪ RENDERER
// ==============================================================
ipcMain.on('zalo-message-from-webview', (event, data) => {
    processZaloMessage(data);
});

ipcMain.on('fb-groups-from-webview', (event, groups) => {
    handleScannedGroups(groups);
});
