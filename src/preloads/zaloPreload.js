const { ipcRenderer } = require('electron');

const seenMessages = new Set();

window.addEventListener('DOMContentLoaded', () => {
    console.log('[PostHub] Zalo Webview Preload đã gắn kết thành công.');

    // 1. Huy hiệu nhận diện trực quan góc trên bên phải Zalo Web
    const badge = document.createElement('div');
    badge.id = 'posthub-zalo-badge';
    badge.innerHTML = `
        <div style="position: fixed; top: 12px; right: 120px; z-index: 999999; background: #0f172a; color: #10b981; padding: 5px 12px; border-radius: 20px; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); border: 1px solid #334155; pointer-events: none;">
            <span style="width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
            <span id="posthub-zalo-text" style="font-weight: 600; color: #f8fafc;">PostHub: Tự Động Bắt Tin Nhóm</span>
        </div>
    `;
    document.body.appendChild(badge);

    // 2. Lấy tên nhóm/hội thoại Zalo đang mở
    function getActiveGroupName() {
        const selectors = [
            '#header-title',
            '.header-title',
            '.chat-title',
            '[data-id="chat-title"]',
            '.conv-item.active .conv-item-title__more',
            '.conv-item.selected .conv-item-title__more',
            '.chat-info__general__title'
        ];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && el.innerText?.trim()) {
                return el.innerText.trim();
            }
        }
        return '';
    }

    // 3. Quét tin nhắn mới trong cửa sổ chat
    function scanMessages() {
        const groupName = getActiveGroupName();
        if (!groupName) return;

        const msgElements = document.querySelectorAll('.chat-message, .msg-view, [id^="msg-"], div[class*="message-view"]');
        msgElements.forEach(el => {
            const msgId = el.getAttribute('id') || el.getAttribute('data-id') || el.innerText.substring(0, 40);
            if (!msgId || seenMessages.has(msgId)) return;

            seenMessages.add(msgId);
            if (seenMessages.size > 2000) seenMessages.clear();

            const senderEl = el.querySelector('.sender-name, [class*="sender"], [class*="author"]');
            const sender = senderEl ? senderEl.innerText.trim() : 'Thành viên';

            const textEl = el.querySelector('.content-text, .msg-text, [class*="content-text"], [class*="text-msg"]');
            const text = textEl ? textEl.innerText.trim() : '';

            const images = [];
            el.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src');
                if (src && !src.includes('avatar') && !src.includes('icon') && !src.includes('emoji')) {
                    images.push(src);
                }
            });

            if (text || images.length > 0) {
                // Gửi tin nhắn bắt được về ứng dụng chính thông qua sendToHost
                ipcRenderer.sendToHost('zalo-message-captured', {
                    groupName,
                    sender,
                    text,
                    images
                });

                // Hiệu ứng nhấp nháy trên huy hiệu
                const textEl = document.getElementById('posthub-zalo-text');
                if (textEl) {
                    textEl.innerText = `⚡ Đã bắt tin từ: ${groupName.substring(0, 16)}...`;
                    setTimeout(() => {
                        textEl.innerText = 'PostHub: Tự Động Bắt Tin Nhóm';
                    }, 2500);
                }
            }
        });
    }

    // 4. Theo dõi DOM liên tục
    const observer = new MutationObserver(() => {
        scanMessages();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 5. Trả về tên nhóm đang mở khi ứng dụng chính yêu cầu
    ipcRenderer.on('get-current-group', () => {
        const activeName = getActiveGroupName();
        ipcRenderer.sendToHost('current-group-response', { groupName: activeName });
    });
});
