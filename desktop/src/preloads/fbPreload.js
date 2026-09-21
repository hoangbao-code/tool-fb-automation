const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    console.log('[PostHub] Facebook Webview Preload đã gắn kết thành công.');

    // 1. Quét các nhóm Facebook xuất hiện trên trang
    function scanGroupsOnPage() {
        const foundGroups = [];
        const seenUrls = new Set();

        const links = document.querySelectorAll('a[href*="/groups/"]');
        links.forEach(a => {
            const href = a.getAttribute('href');
            if (!href) return;

            // Lọc các liên kết nhóm hợp lệ
            const match = href.match(/\/groups\/([^/?]+)/);
            if (match) {
                const groupId = match[1];
                if (['feed', 'discover', 'notifications', 'joins', 'create', 'search'].includes(groupId)) return;

                const fullUrl = `https://www.facebook.com/groups/${groupId}/`;
                if (seenUrls.has(fullUrl)) return;
                seenUrls.add(fullUrl);

                const name = a.innerText?.trim() || a.getAttribute('aria-label') || `Nhóm FB (${groupId})`;
                if (name && name.length > 2 && !name.includes('http')) {
                    foundGroups.push({
                        name: name.replace(/\n.*/g, ''),
                        url: fullUrl,
                        memberCount: ''
                    });
                }
            }
        });

        return foundGroups;
    }

    // 2. Lắng nghe lệnh từ ứng dụng chính
    ipcRenderer.on('scan-groups-cmd', () => {
        const groups = scanGroupsOnPage();
        ipcRenderer.sendToHost('fb-groups-scanned', groups);
    });

    // 3. Tự động bóc tách nhóm nhẹ khi người dùng lướt Facebook
    let lastScanCount = 0;
    setInterval(() => {
        if (window.location.href.includes('/groups')) {
            const groups = scanGroupsOnPage();
            if (groups.length > lastScanCount) {
                lastScanCount = groups.length;
                ipcRenderer.sendToHost('fb-groups-scanned', groups);
            }
        }
    }, 5000);

    // 4. Hỗ trợ tự động điền nội dung vào khung soạn bài
    ipcRenderer.on('publish-to-fb', (event, { postId, content, groups }) => {
        console.log('[PostHub FB] Nhận lệnh đăng bài:', postId, groups);
        // Tự động tìm khung nhập bài đăng và dán nội dung
        const postBox = document.querySelector('[role="textbox"], textarea, div[contenteditable="true"]');
        if (postBox) {
            postBox.focus();
            document.execCommand('insertText', false, content);
            ipcRenderer.sendToHost('fb-post-auto-filled', { postId, success: true });
        }
    });
});
