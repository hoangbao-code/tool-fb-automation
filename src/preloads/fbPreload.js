const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
    console.log('[PostHub] Facebook Webview Preload đã gắn kết thành công.');

    // 1. Quét các nhóm Facebook xuất hiện trên trang
    function scanGroupsOnPage() {
        const foundGroups = [];
        const seenUrls = new Set();
        const excludedIds = [
            'feed', 'discover', 'notifications', 'joins', 'create', 'search',
            'your_groups', 'membership_questions', 'manage', 'chats', 'member',
            'members', 'buy_sell_discussion', 'permalink', 'user', 'about'
        ];

        const links = document.querySelectorAll('a[href*="/groups/"]');
        links.forEach(a => {
            const href = a.getAttribute('href');
            if (!href) return;

            // Lọc ID nhóm từ URL
            const match = href.match(/\/groups\/([^/?#]+)/);
            if (match) {
                const groupId = match[1];
                if (excludedIds.includes(groupId)) return;

                const fullUrl = `https://www.facebook.com/groups/${groupId}/`;
                if (seenUrls.has(fullUrl)) return;
                seenUrls.add(fullUrl);

                const rawText = a.innerText?.trim() || a.getAttribute('aria-label') || '';
                const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
                let name = lines[0] || `Nhóm FB (${groupId})`;

                // Bỏ qua các liên kết điều hướng thông thường
                if (name.includes('Xem tất cả') || name.includes('Tạo nhóm') || name.startsWith('http') || name.length < 2) {
                    return;
                }

                // Tìm thông tin thành viên nếu có
                let memberCount = '';
                for (const l of lines) {
                    if (l.includes('thành viên') || l.toLowerCase().includes('member') || l.includes('bài viết')) {
                        memberCount = l;
                        break;
                    }
                }

                foundGroups.push({
                    name: name,
                    url: fullUrl,
                    memberCount: memberCount
                });
            }
        });

        return foundGroups;
    }

    // 2. Lắng nghe lệnh từ ứng dụng chính (có cuộn nhẹ trang để nạp thêm nhóm)
    ipcRenderer.on('scan-groups-cmd', () => {
        // Cuộn nhẹ xuống để kích hoạt lazy-loading danh sách nhóm của Facebook
        window.scrollBy(0, 800);
        setTimeout(() => {
            window.scrollBy(0, 1200);
            setTimeout(() => {
                const groups = scanGroupsOnPage();
                ipcRenderer.sendToHost('fb-groups-scanned', groups);
            }, 600);
        }, 400);
    });

    // 3. Tự động bóc tách nhóm khi người dùng lướt các trang nhóm Facebook
    let lastScanCount = 0;
    setInterval(() => {
        if (window.location.href.includes('/groups')) {
            const groups = scanGroupsOnPage();
            if (groups.length > lastScanCount) {
                lastScanCount = groups.length;
                ipcRenderer.sendToHost('fb-groups-scanned', groups);
            }
        }
    }, 4000);

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
