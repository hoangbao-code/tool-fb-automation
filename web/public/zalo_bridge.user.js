// ==UserScript==
// @name         PostHub Zalo Web Bridge
// @namespace    https://github.com/hoangbao-code/tool-fb-automation
// @version      1.0.0
// @description  Tự động bắt tin nhắn Zalo Web từ các nhóm theo dõi và chuyển tiếp về PostHub Web Dashboard
// @author       PostHub
// @match        https://chat.zalo.me/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const POSTHUB_API = 'http://localhost:3000/api/zalo/webhook';
    const seenMessages = new Set();
    let isConnected = false;

    console.log('[PostHub] Zalo Web Bridge script đã được nạp.');

    // 1. Tạo huy hiệu trạng thái nhỏ gọn ở góc màn hình Zalo Web
    const badge = document.createElement('div');
    badge.id = 'posthub-status-badge';
    badge.innerHTML = `
        <div style="position: fixed; top: 10px; right: 80px; z-index: 999999; background: #0f172a; color: #fff; padding: 6px 12px; border-radius: 20px; font-size: 11px; font-family: sans-serif; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 1px solid #334155; cursor: pointer;">
            <span id="posthub-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
            <span id="posthub-text" style="font-weight: 600;">PostHub: Đang kết nối...</span>
        </div>
    `;
    document.body.appendChild(badge);

    const dotEl = document.getElementById('posthub-dot');
    const textEl = document.getElementById('posthub-text');

    badge.onclick = () => {
        window.open('http://localhost:3000', '_blank');
    };

    function updateBadge(connected, msg) {
        if (connected) {
            dotEl.style.background = '#10b981';
            textEl.innerText = msg || 'PostHub: Sẵn Sàng';
        } else {
            dotEl.style.background = '#ef4444';
            textEl.innerText = msg || 'PostHub: Chưa bật server (localhost:3000)';
        }
    }

    // 2. Kiểm tra kết nối tới PostHub Server
    function checkServer() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'http://localhost:3000/api/status',
            timeout: 3000,
            onload: function(res) {
                if (res.status === 200) {
                    isConnected = true;
                    updateBadge(true, 'PostHub: Đang theo dõi tin');
                } else {
                    isConnected = false;
                    updateBadge(false);
                }
            },
            onerror: function() {
                isConnected = false;
                updateBadge(false);
            }
        });
    }

    setInterval(checkServer, 10000);
    checkServer();

    // 3. Hàm lấy tên hội thoại / nhóm đang mở
    function getActiveGroupName() {
        const selectors = [
            '#header-title',
            '.header-title',
            '.chat-title',
            '[data-id="chat-title"]',
            '.conv-item.active .conv-item-title__more',
            '.conv-item.selected .conv-item-title__more'
        ];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && el.innerText?.trim()) {
                return el.innerText.trim();
            }
        }
        return '';
    }

    // 4. Bắt tin nhắn mới xuất hiện trên giao diện
    function scanNewMessages() {
        const groupName = getActiveGroupName();
        if (!groupName) return;

        // Tìm các tin nhắn trong vùng chat
        const msgElements = document.querySelectorAll('.chat-message, .msg-view, [id^="msg-"], div[class*="message-view"]');
        msgElements.forEach(el => {
            const msgId = el.getAttribute('id') || el.getAttribute('data-id') || el.innerText.substring(0, 40);
            if (!msgId || seenMessages.has(msgId)) return;

            // Đánh dấu đã quét
            seenMessages.add(msgId);
            if (seenMessages.size > 2000) seenMessages.clear();

            // Lấy người gửi
            const senderEl = el.querySelector('.sender-name, [class*="sender"], [class*="author"]');
            const sender = senderEl ? senderEl.innerText.trim() : 'Thành viên';

            // Lấy văn bản
            const textEl = el.querySelector('.content-text, .msg-text, [class*="content-text"], [class*="text-msg"]');
            const text = textEl ? textEl.innerText.trim() : '';

            // Lấy hình ảnh nếu có
            const images = [];
            el.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src');
                if (src && !src.includes('avatar') && !src.includes('icon') && !src.includes('emoji')) {
                    images.push(src);
                }
            });

            if (text || images.length > 0) {
                sendToPostHub({
                    groupName,
                    sender,
                    text,
                    images
                });
            }
        });
    }

    // 5. Gửi tin nhắn về PostHub Localhost
    function sendToPostHub(payload) {
        console.log('[PostHub Bridge] Gửi tin:', payload);
        
        // Hiệu ứng nhấp nháy trên huy hiệu
        dotEl.style.background = '#38bdf8';
        textEl.innerText = `⚡ Đã bắt tin từ: ${payload.groupName.substring(0, 15)}...`;
        setTimeout(() => {
            if (isConnected) updateBadge(true);
        }, 2000);

        GM_xmlhttpRequest({
            method: 'POST',
            url: POSTHUB_API,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(payload),
            onload: function(res) {
                console.log('[PostHub Bridge] Đã gửi thành công');
            },
            onerror: function(err) {
                console.warn('[PostHub Bridge] Không thể gửi về PostHub:', err);
            }
        });
    }

    // 6. Theo dõi DOM thay đổi liên tục
    const observer = new MutationObserver(() => {
        scanNewMessages();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('[PostHub] Zalo Web Bridge MutationObserver đã kích hoạt.');
})();
