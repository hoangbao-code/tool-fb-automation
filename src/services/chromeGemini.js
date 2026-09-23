/**
 * chromeGemini.js - Điều khiển Google Chrome thực tế (Real Chrome) qua CDP
 * Tự động hóa gửi tin và lấy bài viết từ Gemini Web (gemini.google.com)
 * Không bao giờ bị Google chặn đăng nhập vì sử dụng trình duyệt Google Chrome chính thức!
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_PORT = 9222;

/**
 * Tìm đường dẫn file thực thi Chrome trên Windows
 */
function findChromeExecutable() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];

    for (const p of candidates) {
        if (p && fs.existsSync(p)) {
            return p;
        }
    }
    return null;
}

/**
 * Thư mục User Data riêng cho Gemini Chrome
 * Tách biệt hoàn toàn với Chrome thường để tránh xung đột file lock và lưu vĩnh viễn đăng nhập
 */
function getChromeUserDataDir() {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
    const profileDir = path.join(appData, 'PostHub', 'chrome_gemini_profile');
    if (!fs.existsSync(profileDir)) {
        try {
            fs.mkdirSync(profileDir, { recursive: true });
        } catch (e) {
            console.error('[ChromeGemini] Không thể tạo thư mục profile:', e.message);
        }
    }
    return profileDir;
}

/**
 * Kiểm tra xem Chrome với Remote Debugging có đang mở trên port này không
 */
async function isChromeDebuggingActive(port = DEFAULT_PORT) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(1200)
        });
        if (res.ok) {
            const data = await res.json();
            return { active: true, browser: data.Browser || 'Chrome' };
        }
    } catch (e) {
        // Port không mở
    }
    return { active: false };
}

/**
 * Khởi chạy Google Chrome thực tế với Remote Debugging Port
 */
async function launchChromeGemini(port = DEFAULT_PORT, targetUrl = null) {
    const status = await isChromeDebuggingActive(port);
    if (status.active) {
        return { success: true, message: 'Google Chrome đã đang chạy sẵn!', alreadyRunning: true };
    }

    const chromeExe = findChromeExecutable();
    if (!chromeExe) {
        return {
            success: false,
            message: 'Không tìm thấy Google Chrome trên máy tính của bạn. Vui lòng cài đặt Google Chrome.'
        };
    }

    let startUrl = (targetUrl && isValidGeminiUrl(targetUrl)) ? normalizeGeminiUrl(targetUrl) : null;
    if (!startUrl) {
        try {
            const { dbAsync } = require('../db');
            const row = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_conversation_url'`);
            if (row && row.value && isValidGeminiUrl(row.value)) {
                startUrl = normalizeGeminiUrl(row.value);
            }
        } catch (e) {}
    }
    if (!startUrl) startUrl = 'https://gemini.google.com';

    const userDataDir = getChromeUserDataDir();
    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        startUrl
    ];

    try {
        const proc = spawn(chromeExe, args, {
            detached: true,
            stdio: 'ignore'
        });
        proc.unref();

        // Đợi Chrome sẵn sàng (thử kết nối tối đa 8 giây)
        const startTime = Date.now();
        while (Date.now() - startTime < 8000) {
            await new Promise(r => setTimeout(r, 600));
            const check = await isChromeDebuggingActive(port);
            if (check.active) {
                return { success: true, message: 'Đã khởi chạy Google Chrome thành công!', alreadyRunning: false };
            }
        }

        return { success: true, message: 'Đã gửi lệnh mở Google Chrome.', alreadyRunning: false };
    } catch (err) {
        console.error('[ChromeGemini] Lỗi mở Chrome:', err);
        return { success: false, message: 'Lỗi khởi chạy Chrome: ' + err.message };
    }
}

/**
 * Chuẩn hóa URL Gemini để đảm bảo có https://
 */
function normalizeGeminiUrl(url) {
    if (!url || typeof url !== 'string') return '';
    let clean = url.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
        clean = 'https://' + clean;
    }
    return clean;
}

/**
 * Kiểm tra xem URL có phải là URL hợp lệ của Gemini Web hay không
 * Hỗ trợ gemini.google.com, share.gemini.google
 */
function isValidGeminiUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = normalizeGeminiUrl(url);
    try {
        const u = new URL(clean);
        const host = u.hostname.toLowerCase();
        return (
            host === 'gemini.google.com' ||
            host === 'share.gemini.google' ||
            host.endsWith('.gemini.google.com')
        );
    } catch (e) {
        return false;
    }
}

/**
 * Lấy thông tin URL & Tiêu đề của tab Gemini Web đang mở trong Chrome
 */
async function getActiveGeminiTabInfo(port = DEFAULT_PORT) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json`, {
            signal: AbortSignal.timeout(2000)
        });
        if (!res.ok) return { success: false, error: 'Không thể kết nối Chrome qua cổng ' + port };
        const targets = await res.json();
        
        // Lấy tất cả tab Gemini hợp lệ
        const geminiTabs = targets.filter(t => 
            t.type === 'page' && 
            t.url && 
            isValidGeminiUrl(t.url) && 
            t.webSocketDebuggerUrl
        );

        if (geminiTabs.length === 0) {
            return { success: false, error: 'Chưa tìm thấy tab Gemini Web trong Chrome. Hãy đảm bảo Chrome đang mở trang gemini.google.com.' };
        }

        // Ưu tiên 1: Tab có ID hội thoại cụ thể hoặc link chia sẻ (/app/, /gem/, /share/, share.gemini.google)
        const specificConvTab = geminiTabs.find(t => 
            t.url.includes('/app/') || 
            t.url.includes('/gem/') || 
            t.url.includes('/share/') || 
            t.url.includes('share.gemini.google')
        );

        const chosenTab = specificConvTab || geminiTabs[0];
        return { success: true, url: chosenTab.url, title: chosenTab.title };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Tìm hoặc tạo Tab Gemini Web trong Chrome (hỗ trợ điều hướng đến cuộc trò chuyện chỉ định)
 */
async function getOrOpenGeminiTab(port = DEFAULT_PORT, targetUrl = null) {
    try {
        const res = await fetch(`http://127.0.0.1:${port}/json`, {
            signal: AbortSignal.timeout(2000)
        });
        if (!res.ok) return null;
        const targets = await res.json();

        const cleanTarget = isValidGeminiUrl(targetUrl) ? normalizeGeminiUrl(targetUrl) : null;

        // 1. Tìm tất cả tab Gemini
        const geminiTabs = targets.filter(t => 
            t.type === 'page' && 
            t.url && 
            isValidGeminiUrl(t.url) && 
            t.webSocketDebuggerUrl
        );

        if (geminiTabs.length > 0) {
            let selectedTab = null;

            if (cleanTarget) {
                // Trích xuất mã ID từ targetUrl (ví dụ hIBLCdq9g7B4 hoặc ID hội thoại)
                const targetIdMatch = cleanTarget.match(/(?:app|gem|share)\/([a-zA-Z0-9_-]+)/) || cleanTarget.match(/share\.gemini\.google\/([a-zA-Z0-9_-]+)/);
                const targetId = targetIdMatch ? targetIdMatch[1] : null;

                // Thử tìm tab đã khớp sẵn URL hoặc chứa ID này
                if (targetId) {
                    selectedTab = geminiTabs.find(t => t.url.includes(targetId) || t.url === cleanTarget);
                } else {
                    selectedTab = geminiTabs.find(t => t.url === cleanTarget);
                }

                // Nếu chưa có tab nào đang ở đúng trang, dùng tab đầu tiên và navigate tới targetUrl
                if (!selectedTab) {
                    selectedTab = geminiTabs[0];
                    try {
                        await sendCdpCommand(selectedTab.webSocketDebuggerUrl, 'Page.navigate', { url: cleanTarget }, 15000);
                        // Đợi 3.5 giây cho SPA nạp dữ liệu cuộc trò chuyện
                        await new Promise(r => setTimeout(r, 3500));
                    } catch (navErr) {
                        console.warn('[ChromeGemini] Lỗi điều hướng đến targetUrl:', navErr.message);
                    }
                }
            } else {
                // Không có targetUrl -> ưu tiên tab có conversation ID cụ thể
                selectedTab = geminiTabs.find(t => 
                    t.url.includes('/app/') || 
                    t.url.includes('/gem/') || 
                    t.url.includes('/share/') || 
                    t.url.includes('share.gemini.google')
                ) || geminiTabs[0];
            }

            return selectedTab;
        }

        // 2. Nếu chưa có tab Gemini nào, mở tab mới với targetUrl hoặc trang chủ
        const initialUrl = cleanTarget || 'https://gemini.google.com';

        const newTabRes = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(initialUrl)}`, {
            method: 'PUT',
            signal: AbortSignal.timeout(3000)
        });
        if (newTabRes.ok) {
            const newTab = await newTabRes.json();
            // Đợi 3 giây cho trang nạp sơ bộ
            await new Promise(r => setTimeout(r, 3000));
            return newTab;
        }
    } catch (e) {
        console.error('[ChromeGemini] Lỗi lấy tab Gemini:', e.message);
    }
    return null;
}

/**
 * Thực thi lệnh CDP qua WebSocket
 */
function sendCdpCommand(wsUrl, method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        let ws;
        let isDone = false;
        const reqId = Math.floor(Math.random() * 1000000);

        const timer = setTimeout(() => {
            if (!isDone) {
                isDone = true;
                if (ws) {
                    try { ws.close(); } catch (e) {}
                }
                reject(new Error(`CDP command '${method}' timed out after ${timeoutMs}ms`));
            }
        }, timeoutMs);

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                const message = JSON.stringify({
                    id: reqId,
                    method,
                    params
                });
                ws.send(message);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.id === reqId) {
                        isDone = true;
                        clearTimeout(timer);
                        try { ws.close(); } catch (e) {}
                        if (data.error) {
                            reject(new Error(data.error.message || 'CDP Error'));
                        } else {
                            resolve(data.result);
                        }
                    }
                } catch (err) {
                    console.error('[ChromeGemini] Parse error:', err);
                }
            };

            ws.onerror = (err) => {
                if (!isDone) {
                    isDone = true;
                    clearTimeout(timer);
                    reject(err);
                }
            };
        } catch (e) {
            clearTimeout(timer);
            reject(e);
        }
    });
}

/**
 * Script chạy trong DOM của Gemini Web để gửi tin nhắn và đợi kết quả
 */
const INJECT_SCRIPT = (promptText) => `
(async function() {
    const prompt = ${JSON.stringify(promptText)};

    // 0. Xử lý khi đang ở trang chia sẻ (Share link: share.gemini.google hoặc /share/)
    if (window.location.href.includes('/share/') || window.location.hostname.includes('share.gemini.google')) {
        console.log('[Gemini Web] Phát hiện trang chia sẻ, tìm nút Tiếp tục cuộc trò chuyện...');
        for (let attempt = 0; attempt < 8; attempt++) {
            const allButtons = Array.from(document.querySelectorAll('button, a[role="button"]'));
            const continueBtn = allButtons.find(b => {
                const t = (b.innerText || b.textContent || '').trim().toLowerCase();
                return t.includes('tiếp tục cuộc trò chuyện') || 
                       t.includes('tiếp tục trò chuyện') || 
                       t.includes('continue this chat') || 
                       t.includes('continue chat') ||
                       t === 'tiếp tục' ||
                       t === 'continue';
            });
            if (continueBtn && continueBtn.offsetParent !== null) {
                console.log('[Gemini Web] Đã bấm nút Tiếp tục để mở cuộc trò chuyện chính thức!');
                continueBtn.click();
                await new Promise(r => setTimeout(r, 2500));
                break;
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // 0.1 Xử lý khi đang ở trang New Chat (/ hoặc /app) mà không có cuộc trò chuyện cụ thể
    const curUrl = window.location.href;
    const isNewChat = curUrl.endsWith('gemini.google.com/') || 
                      curUrl.endsWith('gemini.google.com') || 
                      curUrl.endsWith('gemini.google.com/app') || 
                      curUrl.endsWith('gemini.google.com/app/');

    if (isNewChat) {
        // Mở sidebar nếu đang đóng
        const menuBtn = document.querySelector('button[aria-label*="Trình đơn"], button[aria-label*="menu"], button[aria-label*="Main menu"]');
        if (menuBtn && !document.querySelector('mat-sidenav.mat-drawer-opened, nav')) {
            menuBtn.click();
            await new Promise(r => setTimeout(r, 600));
        }

        // Tìm cuộc trò chuyện đã ghim trong sidebar (Pinned conversations)
        const pinnedSelectors = [
            '[data-test-id*="pinned"] a',
            '.pinned-conversations a',
            '[aria-label*="Đã ghim"] a',
            '[aria-label*="Pinned"] a',
            'mat-nav-list a[href*="/app/"]',
            'nav a[href*="/app/"]'
        ];
        for (const sel of pinnedSelectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
                console.log('[Gemini Web] Tự động chọn cuộc trò chuyện đã ghim:', el.innerText || el.href);
                el.click();
                await new Promise(r => setTimeout(r, 2000));
                break;
            }
        }
    }

    // 1. Tìm khung nhập tin nhắn
    function findInput() {
        const selectors = [
            'rich-textarea [contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"]',
            'textarea[placeholder]',
            'rich-textarea p',
            'textarea'
        ];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el && el.offsetParent !== null) return el;
        }
        return null;
    }

    // 2. Tìm nút Gửi
    function findSendButton() {
        const sendSelectors = [
            'button[aria-label*="Send"]',
            'button[aria-label*="Gửi"]',
            'button[aria-label*="send"]',
            'button[aria-label*="gửi"]',
            'button.send-button',
            'button[mat-icon-button][aria-label*="Send"]'
        ];
        for (const s of sendSelectors) {
            const btn = document.querySelector(s);
            if (btn && !btn.disabled && btn.offsetParent !== null) return btn;
        }
        return null;
    }

    // 3. Đếm số lượng phản hồi hiện có của model
    function getResponseCount() {
        const list = document.querySelectorAll('message-content, .model-response-text, model-response, [data-message-author-role="model"]');
        return list.length;
    }

    // 4. Lấy nội dung phản hồi mới nhất
    function getLatestResponseText() {
        const list = document.querySelectorAll('message-content, .model-response-text, model-response, [data-message-author-role="model"]');
        if (list.length === 0) return null;
        const last = list[list.length - 1];
        return last.innerText || last.textContent;
    }

    // 5. Kiểm tra AI còn đang gõ/stream không
    function isAiGenerating() {
        const stopSelectors = [
            'button[aria-label*="Stop"]',
            'button[aria-label*="Dừng"]',
            'button[aria-label*="stop"]',
            'button[aria-label*="dừng"]',
            '.sparkle-animation',
            '.generating'
        ];
        for (const s of stopSelectors) {
            const el = document.querySelector(s);
            if (el && el.offsetParent !== null) return true;
        }
        return false;
    }

    // Đợi ô nhập tin nhắn xuất hiện (tối đa 12 giây)
    let inputEl = null;
    const findStart = Date.now();
    while (Date.now() - findStart < 12000) {
        inputEl = findInput();
        if (inputEl) break;
        await new Promise(r => setTimeout(r, 600));
    }

    if (!inputEl) {
        return { 
            success: false, 
            error: 'Chưa thấy ô nhập chat Gemini Web trên Chrome. Vui lòng kiểm tra xem Chrome đã mở cuộc trò chuyện chưa (URL hiện tại: ' + window.location.href + ')' 
        };
    }

    const initialResponseCount = getResponseCount();

    // Điền nội dung vào ô chat
    inputEl.focus();
    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        inputEl.value = prompt;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        // ContentEditable element
        inputEl.innerText = prompt;
        inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    }

    await new Promise(r => setTimeout(r, 600));

    // Bấm nút gửi hoặc dispatch phím Enter
    const sendBtn = findSendButton();
    if (sendBtn) {
        sendBtn.click();
    } else {
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    }

    // Chờ phản hồi bắt đầu sinh và hoàn thành (tối đa 38 giây)
    const startTime = Date.now();
    let generationStarted = false;
    let lastLength = 0;
    let stableCount = 0;

    while (Date.now() - startTime < 65000) {
        await new Promise(r => setTimeout(r, 1000));
        const currentCount = getResponseCount();
        const generating = isAiGenerating();

        if (currentCount > initialResponseCount || generating) {
            generationStarted = true;
        }

        if (generationStarted && !generating) {
            // Kiểm tra xem độ dài text có ổn định trong 2 lần kiểm tra liên tiếp không
            const currentText = getLatestResponseText() || '';
            if (currentText.length > 30) {
                if (currentText.length === lastLength) {
                    stableCount++;
                    if (stableCount >= 2) {
                        return { 
                            success: true, 
                            text: currentText,
                            finalUrl: window.location.href,
                            title: document.title
                        };
                    }
                } else {
                    lastLength = currentText.length;
                    stableCount = 0;
                }
            }
        }
    }

    const fallbackText = getLatestResponseText();
    if (fallbackText && fallbackText.length > 20) {
        return { 
            success: true, 
            text: fallbackText,
            finalUrl: window.location.href,
            title: document.title
        };
    }

    return { success: false, error: 'Quá thời gian chờ Gemini trả lời trên Chrome (đã đợi hơn 65 giây).' };
})();
`;

/**
 * Gửi tin nhắn qua Chrome Gemini và nhận kết quả
 * @param {string} promptText - Nội dung tin nhắn cần gửi
 * @param {number} port - Cổng remote debugging (mặc định 9222)
 * @param {string} targetUrl - URL cuộc trò chuyện đã ghim / Gem (tùy chọn)
 */
async function sendPromptToChromeGemini(promptText, port = DEFAULT_PORT, targetUrl = null) {
    const status = await isChromeDebuggingActive(port);
    if (!status.active) {
        // Thử tự động mở Chrome nếu chưa mở
        const launchRes = await launchChromeGemini(port);
        if (!launchRes.success) {
            return { success: false, error: 'Google Chrome chưa được mở và không thể tự khởi chạy: ' + launchRes.message };
        }
        await new Promise(r => setTimeout(r, 3000));
    }

    const geminiTab = await getOrOpenGeminiTab(port, targetUrl);
    if (!geminiTab || !geminiTab.webSocketDebuggerUrl) {
        return { success: false, error: 'Không tìm thấy tab Gemini Web trong Google Chrome. Hãy đảm bảo Chrome đang mở trang gemini.google.com.' };
    }

    try {
        const evalResult = await sendCdpCommand(geminiTab.webSocketDebuggerUrl, 'Runtime.evaluate', {
            expression: INJECT_SCRIPT(promptText),
            awaitPromise: true,
            returnByValue: true
        }, 75000);

        if (evalResult && evalResult.result && evalResult.result.value) {
            const val = evalResult.result.value;
            if (val.success) {
                return { 
                    success: true, 
                    text: val.text,
                    finalUrl: val.finalUrl,
                    title: val.title
                };
            } else {
                return { success: false, error: val.error || 'Lỗi không xác định từ Gemini DOM.' };
            }
        }

        return { success: false, error: 'Không nhận được dữ liệu phản hồi từ Chrome.' };
    } catch (err) {
        console.error('[ChromeGemini] Lỗi gửi tin nhắn qua CDP:', err);
        return { success: false, error: err.message };
    }
}

module.exports = {
    findChromeExecutable,
    getChromeUserDataDir,
    isChromeDebuggingActive,
    launchChromeGemini,
    getActiveGeminiTabInfo,
    getOrOpenGeminiTab,
    sendPromptToChromeGemini,
    normalizeGeminiUrl,
    isValidGeminiUrl,
    DEFAULT_PORT
};
