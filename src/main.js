const { app, BrowserWindow, ipcMain, session, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { dbAsync } = require('./db');
const { testGemini } = require('./services/gemini');
const { processZaloMessage, setEventBroadcaster } = require('./services/zaloEngine');
const {
    handleScannedGroups,
    publishPost,
    startFbPostWorker,
    setFbEventBroadcaster
} = require('./services/fbEngine');

dotenv.config();

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
    const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    
    const zaloSession = session.fromPartition('persist:zalo');
    zaloSession.setUserAgent(desktopUA);

    const fbSession = session.fromPartition('persist:fb');
    fbSession.setUserAgent(desktopUA);

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

ipcMain.handle('delete-zalo-group', async (event, id) => {
    try {
        await dbAsync.run(`DELETE FROM zalo_groups WHERE id = ?`, [id]);
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

// 5. Bài viết & Hàng đợi
ipcMain.handle('get-posts', async () => {
    try {
        const posts = await dbAsync.all(`SELECT * FROM posts ORDER BY id DESC LIMIT 100`);
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

ipcMain.handle('publish-post', async (event, id) => {
    try {
        const result = await publishPost(id);
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

// 6. Kiểm tra AI
ipcMain.handle('test-ai', async (event, { apiKey, promptTemplate, model }) => {
    try {
        const result = await testGemini(apiKey, promptTemplate, model);
        return { success: true, result };
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

// ==============================================================
// XỬ LÝ SỰ KIỆN TỪ WEBVIEW ZALO VÀ FACEBOOK QUA IPC TỪ RENDERER
// ==============================================================
ipcMain.on('zalo-message-from-webview', (event, data) => {
    processZaloMessage(data);
});

ipcMain.on('fb-groups-from-webview', (event, groups) => {
    handleScannedGroups(groups);
});
