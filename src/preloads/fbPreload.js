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

                let candidateName = '';
                const spanEl = a.querySelector('span[dir="auto"]');
                if (spanEl && spanEl.innerText && spanEl.innerText.trim().length >= 2) {
                    candidateName = spanEl.innerText.trim();
                }
                if (!candidateName) {
                    const strongEl = a.querySelector('strong, h2, h3, h4');
                    if (strongEl && strongEl.innerText && strongEl.innerText.trim().length >= 2) {
                        candidateName = strongEl.innerText.trim();
                    }
                }
                if (!candidateName) {
                    candidateName = lines[0] || '';
                }

                const badgeWords = ['Đã tham gia', 'Truy cập', 'Xem nhóm', 'Tham gia nhóm', 'Nhóm công khai', 'Nhóm riêng tư', 'Đang chờ'];
                if (badgeWords.includes(candidateName) && lines.length > 1) {
                    for (const l of lines) {
                        if (!badgeWords.includes(l) && l.length >= 2 && !l.startsWith('http')) {
                            candidateName = l;
                            break;
                        }
                    }
                }

                let cleanName = candidateName
                    .replace(/^(Đã tham gia|Nhóm|Xem nhóm|Truy cập|Tham gia nhóm|Đang chờ)\s*[:·-]?\s*/i, '')
                    .replace(/\s*·\s*(Đã tham gia|Công khai|Riêng tư|Thành viên|Bài viết mới).*$/i, '')
                    .trim();

                if (!cleanName || cleanName.includes('Xem tất cả') || cleanName.includes('Tạo nhóm') || cleanName.startsWith('http') || cleanName.length < 2) {
                    cleanName = `Nhóm FB (${groupId})`;
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
                    name: cleanName,
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
});
