const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('electronApi', {
    // 0. Đường dẫn Preload Webview
    zaloPreloadPath: path.join(__dirname, 'zaloPreload.js'),
    fbPreloadPath: path.join(__dirname, 'fbPreload.js'),
    forwardZaloMessage: (data) => ipcRenderer.send('zalo-message-from-webview', data),
    forwardFbGroups: (groups) => ipcRenderer.send('fb-groups-from-webview', groups),

    // 1. Trạng thái & Thống kê
    getStatus: () => ipcRenderer.invoke('get-status'),

    // 2. Cài đặt hệ thống
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

    // 3. Nhóm Zalo
    getZaloGroups: () => ipcRenderer.invoke('get-zalo-groups'),
    addZaloGroup: (name) => ipcRenderer.invoke('add-zalo-group', name),
    deleteZaloGroup: (id) => ipcRenderer.invoke('delete-zalo-group', id),
    toggleZaloGroup: (id) => ipcRenderer.invoke('toggle-zalo-group', id),

    // 4. Nhóm Facebook
    getFbGroups: () => ipcRenderer.invoke('get-fb-groups'),
    addFbGroup: (name, url) => ipcRenderer.invoke('add-fb-group', { name, url }),
    deleteFbGroup: (id) => ipcRenderer.invoke('delete-fb-group', id),
    toggleFbGroup: (id) => ipcRenderer.invoke('toggle-fb-group', id),

    // 5. Hàng đợi bài viết & Đăng bài
    getPosts: () => ipcRenderer.invoke('get-posts'),
    updatePost: (id, text, status) => ipcRenderer.invoke('update-post', { id, text, status }),
    publishPost: (id) => ipcRenderer.invoke('publish-post', id),
    deletePost: (id) => ipcRenderer.invoke('delete-post', id),

    // 6. Thử nghiệm AI
    testAi: (apiKey, promptTemplate, model) => ipcRenderer.invoke('test-ai', { apiKey, promptTemplate, model }),

    // 7. Nhật ký
    getLogs: () => ipcRenderer.invoke('get-logs'),

    // 8. Sao lưu & Phục hồi dữ liệu
    exportBackup: () => ipcRenderer.invoke('export-backup'),
    importBackup: (backupData) => ipcRenderer.invoke('import-backup', backupData),
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),

    // 9. Lắng nghe các sự kiện hệ thống thời gian thực
    on: (channel, callback) => {
        const validChannels = [
            'new-zalo-message',
            'new-post-ready',
            'post-published',
            'fb-groups-updated',
            'new-log-entry',
            'status-updated'
        ];
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (event, ...args) => callback(...args));
        }
    }
});
