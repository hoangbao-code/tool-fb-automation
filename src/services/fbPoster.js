/**
 * Dịch vụ Đăng Bài Facebook Thực Tế & Trích Xuất Link Bài Viết (Permalink)
 * Hỗ trợ 2 phương thức:
 * 1. Webview DOM Automation (Tự động hóa trên giao diện Facebook Web của ứng dụng)
 * 2. Direct HTTP Cookies (Dự phòng qua mbasic.facebook.com)
 */

const fs = require('fs');
const path = require('path');

const USER_AGENT_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * Nạp danh sách đường dẫn ảnh từ đĩa hoặc URL và chuyển thành Base64
 */
async function loadImagesAsBase64(imagesInput, maxImages = 20) {
    if (!imagesInput) return [];
    let list = [];
    if (typeof imagesInput === 'string') {
        try {
            const parsed = JSON.parse(imagesInput);
            list = Array.isArray(parsed) ? parsed : [parsed];
        } catch(e) {
            list = [imagesInput];
        }
    } else if (Array.isArray(imagesInput)) {
        list = imagesInput;
    }

    const results = [];
    for (const item of list.slice(0, maxImages)) {
        if (!item || typeof item !== 'string') continue;
        try {
            if (fs.existsSync(item)) {
                const buf = fs.readFileSync(item);
                const ext = path.extname(item).toLowerCase();
                const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
                results.push({
                    name: path.basename(item),
                    mime,
                    base64: buf.toString('base64')
                });
            } else if (item.startsWith('http://') || item.startsWith('https://')) {
                const res = await fetch(item);
                if (res.ok) {
                    const buf = Buffer.from(await res.arrayBuffer());
                    const cType = res.headers.get('content-type') || 'image/jpeg';
                    results.push({
                        name: `image_${Date.now()}_${results.length}.jpg`,
                        mime: cType,
                        base64: buf.toString('base64')
                    });
                }
            } else {
                const relPath = path.resolve(__dirname, '..', '..', item.replace(/^[/\\]/, ''));
                if (fs.existsSync(relPath)) {
                    const buf = fs.readFileSync(relPath);
                    results.push({
                        name: path.basename(relPath),
                        mime: 'image/jpeg',
                        base64: buf.toString('base64')
                    });
                }
            }
        } catch(e) {
            console.warn('[FB Poster] Không nạp được ảnh:', item, e.message);
        }
    }
    return results;
}

/**
 * Script nhúng chạy trực tiếp trong DOM Facebook Group
 */
const FB_DOM_POST_SCRIPT = (content, imagesData = []) => `
(async function() {
    try {
        const textToPost = ${JSON.stringify(content || '')};
        const imagesToUpload = ${JSON.stringify(imagesData || [])};
        const startTime = Date.now();

        // 0. Hàm dispatch sự kiện click toàn diện (Pointer, Mouse, Native) tương thích React 18+
        function clickElement(el) {
            if (!el) return;
            try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
            try { el.focus(); } catch (e) {}
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const eventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
            try { el.dispatchEvent(new PointerEvent('pointerdown', eventInit)); } catch (e) {}
            try { el.dispatchEvent(new MouseEvent('mousedown', eventInit)); } catch (e) {}
            try { el.dispatchEvent(new PointerEvent('pointerup', eventInit)); } catch (e) {}
            try { el.dispatchEvent(new MouseEvent('mouseup', eventInit)); } catch (e) {}
            try { el.dispatchEvent(new MouseEvent('click', eventInit)); } catch (e) {}
            if (typeof el.click === 'function') {
                try { el.click(); } catch (e) {}
            }
        }

        // 1. Kiểm tra nếu bị chuyển hướng về trang đăng nhập hoặc checkpoint
        if (window.location.href.includes('/login') || window.location.href.includes('checkpoint')) {
            return { success: false, error: 'Chưa đăng nhập Facebook hoặc phiên đã hết hạn. Hãy đăng nhập lại trong tab Facebook Web.' };
        }

        // 1.1 Tự động xử lý pop-up Quy tắc nhóm (Group Rules) hoặc xác nhận câu hỏi
        function handleGroupRulesAndConfirmations() {
            try {
                // Tự động tích các checkbox quy tắc nhóm nếu có
                const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], div[role="checkbox"]'));
                for (const cb of checkboxes) {
                    const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true';
                    if (!isChecked && cb.offsetParent !== null) {
                        clickElement(cb);
                    }
                }

                // Tìm nút "Đồng ý" / "Xác nhận" / "Tôi đồng ý" trong dialog quy tắc
                const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                for (const d of dialogs) {
                    const dText = (d.innerText || '').toLowerCase();
                    if (dText.includes('quy tắc nhóm') || dText.includes('group rules') || 
                        dText.includes('trước khi đăng bài') || dText.includes('before you post')) {
                        const btns = Array.from(d.querySelectorAll('div[role="button"], button'));
                        for (const b of btns) {
                            if (b.offsetParent === null) continue;
                            const bText = (b.innerText || b.textContent || '').trim().toLowerCase();
                            const bAria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                            if (bText === 'tôi đồng ý' || bText === 'đồng ý' || bText === 'i agree' || bText === 'agree' ||
                                bText === 'gửi' || bText === 'submit' || bText === 'xác nhận' || bText === 'confirm' ||
                                bText === 'hoàn tất' || bText === 'done' || bAria === 'tôi đồng ý' || bAria === 'i agree') {
                                clickElement(b);
                                return true;
                            }
                        }
                    }
                }
            } catch (e) {}
            return false;
        }

        // 1.2 Tự động chuyển sang tab "Thảo luận" (Discussion) nếu là nhóm Mua Bán (Buy/Sell)
        // Tránh tình trạng mở khung bán hàng Marketplace
        function ensureDiscussionTab() {
            try {
                const candidates = Array.from(document.querySelectorAll('a[role="tab"], div[role="tab"], div[role="button"], a[role="link"], span'));
                for (const el of candidates) {
                    if (el.offsetParent === null) continue;
                    const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
                    if (text === 'thảo luận' || aria === 'thảo luận' || 
                        text === 'discussion' || aria === 'discussion' ||
                        text === 'bắt đầu cuộc thảo luận' || text === 'tạo bài thảo luận' || text === 'start discussion') {
                        const tabBtn = el.closest('[role="tab"]') || el.closest('[role="button"]') || el.closest('a') || el;
                        const isSelected = tabBtn.getAttribute('aria-selected') === 'true';
                        if (!isSelected) {
                            clickElement(tabBtn);
                            return true;
                        }
                    }
                }
            } catch (e) {}
            return false;
        }

        handleGroupRulesAndConfirmations();

        // 2. Tìm nút mở khung soạn bài (Composer Trigger)
        const triggerKeywords = [
            'bạn viết gì đi',
            'tạo bài viết công khai',
            'tạo bài viết',
            'bạn đang nghĩ gì',
            'viết gì đó',
            'bắt đầu cuộc thảo luận',
            'tạo bài thảo luận',
            'write something',
            'create a public post',
            'create a post',
            'what\\'s on your mind',
            'start discussion'
        ];

        const excludedKeywords = [
            'bán gì đó',
            'mục để bán',
            'sell something',
            'items for sale',
            'bán hàng',
            'niêm yết'
        ];

        function findComposerTrigger() {
            // Nếu đã mở sẵn dialog tạo bài viết thì không cần bấm trigger nữa
            if (document.querySelector('div[role="dialog"] div[role="textbox"][contenteditable="true"]')) {
                return null;
            }

            const elements = Array.from(document.querySelectorAll('span, div[role="button"], div[tabindex="0"]'));
            for (const el of elements) {
                if (el.offsetParent === null) continue;
                const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();

                // Bỏ qua các nút mua bán / marketplace
                let isExcluded = false;
                for (const ex of excludedKeywords) {
                    if (text.includes(ex) || aria.includes(ex)) {
                        isExcluded = true;
                        break;
                    }
                }
                if (isExcluded) continue;

                for (const kw of triggerKeywords) {
                    if (text === kw || (text.includes(kw) && text.length < 50) || aria.includes(kw)) {
                        const btn = el.closest('[role="button"]') || el.closest('[tabindex="0"]') || el;
                        if (btn && btn.offsetParent !== null) return btn;
                    }
                }
            }

            // Fallback: Tìm nút trong GroupInlineComposer, tránh nút bán hàng và avatar
            const composerArea = document.querySelector('div[data-pagelet="GroupInlineComposer"], div[role="region"]');
            if (composerArea) {
                const buttons = Array.from(composerArea.querySelectorAll('div[role="button"], div[tabindex="0"]'));
                for (const btn of buttons) {
                    if (btn.offsetParent === null) continue;
                    const bText = (btn.innerText || btn.textContent || '').toLowerCase();
                    const bAria = (btn.getAttribute('aria-label') || '').toLowerCase();
                    if (!bText.includes('bán') && !bAria.includes('bán') && !bText.includes('sell') && !bAria.includes('sell')) {
                        if (!bAria.includes('trang cá nhân') && !bAria.includes('profile')) {
                            return btn;
                        }
                    }
                }
            }

            return null;
        }

        // Kiểm tra xem editor đã mở sẵn chưa
        let editor = null;
        const initialDialog = document.querySelector('div[role="dialog"]');
        if (initialDialog) {
            editor = initialDialog.querySelector('div[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
        }

        if (!editor) {
            // Chuyển tab Thảo luận nếu là nhóm Mua Bán
            if (ensureDiscussionTab()) {
                await new Promise(r => setTimeout(r, 1000));
            }

            let triggerBtn = null;
            for (let i = 0; i < 20; i++) {
                handleGroupRulesAndConfirmations();
                triggerBtn = findComposerTrigger();
                if (triggerBtn) break;
                if (i === 5 || i === 10) {
                    ensureDiscussionTab();
                }
                await new Promise(r => setTimeout(r, 400));
            }

            if (triggerBtn) {
                clickElement(triggerBtn);
                await new Promise(r => setTimeout(r, 600));
            } else {
                if (!document.querySelector('div[role="dialog"]')) {
                    const pageText = (document.body.innerText || '').toLowerCase();
                    if (pageText.includes('tham gia nhóm') || pageText.includes('join group')) {
                        return { success: false, error: 'Tài khoản chưa tham gia nhóm này. Vui lòng bấm Tham Gia Nhóm trên Facebook trước.' };
                    }
                    if (pageText.includes('tạm thời bị chặn') || pageText.includes('temporarily blocked')) {
                        return { success: false, error: 'Tài khoản đang bị Facebook tạm khóa tính năng đăng bài trong nhóm này (Spam filter).' };
                    }
                }
            }

            // 3. Chờ Dialog tạo bài viết xuất hiện
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 300));
                handleGroupRulesAndConfirmations();

                const dialog = document.querySelector('div[role="dialog"]');
                const searchContext = dialog || document;
                editor = searchContext.querySelector('div[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
                if (editor && editor.offsetParent !== null) break;

                // Thử click lại trigger nếu sau 10 lượt chưa hiện
                if (i === 10 && triggerBtn) {
                    clickElement(triggerBtn);
                }
            }
        }

        if (!editor) {
            return { success: false, error: 'Không mở được khung soạn thảo bài viết của Facebook (Nhóm có thể yêu cầu câu hỏi thành viên hoặc bị hạn chế).' };
        }

        // 4. Nhập nội dung bài viết vào editor (hỗ trợ Lexical / Draft.js của Facebook)
        editor.focus();
        await new Promise(r => setTimeout(r, 150));

        // Xóa sạch nội dung cũ nếu có để tránh dồn/lặp bài
        try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false, null);
        } catch (e) {}
        await new Promise(r => setTimeout(r, 100));

        let hasContent = false;

        // Ưu tiên 1: Giả lập Paste qua ClipboardEvent & DataTransfer (tương thích chuẩn nhất với Lexical / React)
        try {
            const dt = new DataTransfer();
            dt.setData('text/plain', textToPost);
            const pasteEvt = new ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true
            });
            editor.dispatchEvent(pasteEvt);
        } catch (e) {}

        // Chờ Lexical render nội dung đã paste
        await new Promise(r => setTimeout(r, 350));

        const curLen = (editor.innerText || editor.textContent || '').trim().length;
        if (curLen >= 5) {
            hasContent = true;
        }

        // Ưu tiên 2: Nếu Paste không ăn (hiếm khi xảy ra), dùng execCommand từng dòng
        if (!hasContent) {
            try {
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);
                const lines = textToPost.split(/\r?\n/);
                for (let li = 0; li < lines.length; li++) {
                    if (lines[li].length > 0) document.execCommand('insertText', false, lines[li]);
                    if (li < lines.length - 1) document.execCommand('insertParagraph', false, null);
                }
            } catch (e) {}

            await new Promise(r => setTimeout(r, 200));
            const afterLen = (editor.innerText || editor.textContent || '').trim().length;
            if (afterLen >= 5) hasContent = true;
        }

        // Ưu tiên 3: Nếu cả 2 cách trên đều chưa ăn, mới gán textContent trực tiếp
        if (!hasContent) {
            editor.textContent = textToPost;
        }

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));

        // 4.1 Đính kèm hình ảnh (nếu có)
        if (Array.isArray(imagesToUpload) && imagesToUpload.length > 0) {
            try {
                function b64toFile(b64, name, mime) {
                    const bin = atob(b64);
                    const len = bin.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
                    return new File([bytes], name, { type: mime || 'image/jpeg' });
                }

                const domFiles = [];
                for (const f of imagesToUpload) {
                    try {
                        domFiles.push(b64toFile(f.base64, f.name, f.mime));
                    } catch (e) {}
                }

                if (domFiles.length > 0) {
                    const dialogCtx = document.querySelector('div[role="dialog"]') || document;
                    let fileInput = dialogCtx.querySelector('input[type="file"][accept*="image"], input[type="file"]');
                    if (!fileInput) {
                        const photoBtns = Array.from(dialogCtx.querySelectorAll('div[aria-label*="Ảnh"], div[aria-label*="Photo"], div[role="button"]'));
                        for (const pb of photoBtns) {
                            const aria = (pb.getAttribute('aria-label') || '').toLowerCase();
                            if (aria.includes('ảnh') || aria.includes('photo')) {
                                clickElement(pb);
                                await new Promise(r => setTimeout(r, 600));
                                fileInput = dialogCtx.querySelector('input[type="file"][accept*="image"], input[type="file"]');
                                if (fileInput) break;
                            }
                        }
                    }

                    if (fileInput) {
                        const dt = new DataTransfer();
                        domFiles.forEach(f => dt.items.add(f));
                        fileInput.files = dt.files;
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
                        await new Promise(r => setTimeout(r, 1200));
                    }
                }
            } catch (imgErr) {
                console.warn('[FB DOM] Bỏ qua lỗi ảnh:', imgErr);
            }
        }

        // 5. Tìm nút "Đăng" / "Post"
        function findSubmitButton() {
            const searchContext = document.querySelector('div[role="dialog"]') || document;
            const buttons = Array.from(searchContext.querySelectorAll('div[role="button"], button'));
            
            // Lượt 1: Tìm nút Đăng đang khả dụng (không bị disabled)
            for (const b of buttons) {
                if (b.offsetParent === null) continue;
                const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                const isDisabled = b.getAttribute('aria-disabled') === 'true' || b.disabled;

                if ((aria === 'đăng' || aria === 'post' || text === 'đăng' || text === 'post') && !isDisabled) {
                    return b;
                }
            }

            // Lượt 2: Tìm nút có tên "đăng" / "post"
            for (const b of buttons) {
                if (b.offsetParent === null) continue;
                const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                if (aria === 'đăng' || aria === 'post' || text === 'đăng' || text === 'post') {
                    return b;
                }
            }

            return null;
        }

        let submitBtn = null;
        for (let i = 0; i < 20; i++) {
            submitBtn = findSubmitButton();
            if (submitBtn) {
                const isDisabled = submitBtn.getAttribute('aria-disabled') === 'true' || submitBtn.disabled;
                if (!isDisabled) break;

                // Nếu nút Đăng bị disabled (do Lexical chưa kịp đồng bộ), kích hoạt thêm 1 phím Space + Backspace để đánh thức state
                if (i % 3 === 0) {
                    try {
                        editor.focus();
                        document.execCommand('insertText', false, ' ');
                        document.execCommand('delete', false, null);
                        editor.dispatchEvent(new Event('input', { bubbles: true }));
                    } catch (e) {}
                }
            }
            await new Promise(r => setTimeout(r, 300));
        }

        if (!submitBtn) {
            return { success: false, error: 'Không tìm thấy nút "Đăng" khả dụng trên Facebook.' };
        }

        // Bấm nút Đăng
        clickElement(submitBtn);

        // 6. Chờ Facebook xử lý đăng bài
        let isPosted = false;
        let isPendingApproval = false;
        const waitSubmitStart = Date.now();

        while (Date.now() - waitSubmitStart < 30000) {
            await new Promise(r => setTimeout(r, 800));

            handleGroupRulesAndConfirmations();

            const bodyText = (document.body.innerText || '').toLowerCase();
            if (bodyText.includes('chờ quản trị viên phê duyệt') || 
                bodyText.includes('đang chờ phê duyệt') || 
                bodyText.includes('pending approval') || 
                bodyText.includes('submitted for approval')) {
                isPendingApproval = true;
                isPosted = true;
                break;
            }

            if (bodyText.includes('bạn tạm thời bị chặn') || bodyText.includes('temporarily blocked')) {
                return { success: false, error: 'Facebook tạm thời chặn tài khoản đăng bài vào nhóm (Spam filter).' };
            }

            const currentDialog = document.querySelector('div[role="dialog"]');
            if (!currentDialog) {
                isPosted = true;
                break;
            }
        }

        await new Promise(r => setTimeout(r, 1200));

        // 7. Bóc tách Link bài viết (Permalink)
        const curUrl = window.location.href;
        const curGroupUrl = curUrl.split('?')[0];

        function extractLatestPostLink() {
            try {
                const groupMatch = curUrl.match(new RegExp('/groups/([^/?#]+)'));
                const groupId = groupMatch ? groupMatch[1] : null;

                const links = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]'));
                for (const a of links) {
                    const text = (a.innerText || a.textContent || '').trim().toLowerCase();
                    const aria = (a.getAttribute('aria-label') || '').toLowerCase();
                    const isJustNow = text.includes('vừa xong') || text.includes('just now') || 
                                      text.includes('1 phút') || text.includes('1 min') || 
                                      aria.includes('vừa xong') || aria.includes('just now');
                    const href = a.getAttribute('href') || '';
                    if (isJustNow) {
                        let cleanHref = href.split('?')[0];
                        if (cleanHref.startsWith('/')) cleanHref = 'https://www.facebook.com' + cleanHref;
                        return cleanHref;
                    }
                }

                if (links.length > 0) {
                    let firstHref = links[0].getAttribute('href') || '';
                    let clean = firstHref.split('?')[0];
                    if (clean.startsWith('/')) clean = 'https://www.facebook.com' + clean;
                    if (!groupId || clean.includes(groupId)) {
                        return clean;
                    }
                }
            } catch (e) {}
            return null;
        }

        const postLink = extractLatestPostLink();

        if (isPendingApproval) {
            return {
                success: true,
                status: 'pending_approval',
                postUrl: curGroupUrl.replace(/\\/?$/, '') + '/pending_posts',
                message: 'Bài viết đã được gửi và đang chờ Quản trị viên duyệt.'
            };
        }

        return {
            success: true,
            status: 'posted',
            postUrl: postLink || curGroupUrl,
            message: postLink ? 'Đã đăng bài thành công lên Facebook!' : 'Đã đăng bài thành công.'
        };

    } catch (err) {
        return {
            success: false,
            error: 'Lỗi thực thi DOM Facebook: ' + (err.stack || err.message)
        };
    }
})();
`;

/**
 * Đăng bài qua Webview DOM Automation
 */
async function postViaWebview(webContents, { groupUrl, content, images }) {
    if (!webContents || webContents.isDestroyed()) {
        return { success: false, error: 'Webview Facebook chưa được khởi tạo hoặc đã bị đóng.' };
    }

    try {
        const imagesData = await loadImagesAsBase64(images);

        // 1. Điều hướng webview sang URL của nhóm
        await new Promise((resolve) => {
            if (process.env.NODE_ENV === 'test') {
                if (typeof webContents.loadURL === 'function') {
                    webContents.loadURL(groupUrl).then(() => resolve()).catch(() => resolve());
                } else {
                    resolve();
                }
                return;
            }

            const timeout = setTimeout(() => {
                resolve();
            }, 15000);

            let finished = false;
            const handleDidFinish = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timeout);
                if (typeof webContents.removeListener === 'function') {
                    webContents.removeListener('did-finish-load', handleDidFinish);
                }
                resolve();
            };

            if (typeof webContents.once === 'function') {
                webContents.once('did-finish-load', handleDidFinish);
            }
            if (typeof webContents.loadURL === 'function') {
                webContents.loadURL(groupUrl)
                    .then(() => handleDidFinish())
                    .catch(() => resolve());
            } else {
                resolve();
            }
        });

        // Đợi để React/GraphQL nạp đầy đủ giao diện nhóm
        if (process.env.NODE_ENV === 'test') {
            await new Promise(r => setTimeout(r, 10));
        } else {
            await new Promise(r => setTimeout(r, 3500));
        }

        // 2. Chạy script đăng bài trong DOM
        const result = await webContents.executeJavaScript(FB_DOM_POST_SCRIPT(content, imagesData));
        return result || { success: false, error: 'Không nhận được phản hồi từ Facebook Webview.' };

    } catch (err) {
        return { success: false, error: `Lỗi đăng bài qua Webview: ${err.message}` };
    }
}

/**
 * Đăng bài dự phòng qua Direct HTTP Cookies (mbasic.facebook.com)
 */
async function postViaCookies(cookiesString, { groupUrl, content }) {
    if (!cookiesString || typeof cookiesString !== 'string' || cookiesString.trim().length < 10) {
        return { success: false, error: 'Chưa có cookie Facebook hợp lệ.' };
    }

    const groupMatch = groupUrl.match(/\/groups\/([^/?#]+)/);
    if (!groupMatch) {
        return { success: false, error: `URL nhóm không hợp lệ: ${groupUrl}` };
    }
    const groupId = groupMatch[1];
    const mbasicUrl = `https://mbasic.facebook.com/groups/${groupId}/`;

    try {
        // 1. GET form soạn bài trên mbasic
        const getResp = await fetch(mbasicUrl, {
            headers: {
                'User-Agent': USER_AGENT_MOBILE,
                'Cookie': cookiesString,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            redirect: 'follow'
        });

        if (getResp.url.includes('/login') || getResp.url.includes('checkpoint')) {
            return { success: false, error: 'Phiên cookie Facebook đã hết hạn. Vui lòng đăng nhập lại!' };
        }

        const html = await getResp.text();

        // 2. Bóc tách form đăng bài (action chứa /composer/mbasic/...)
        const formMatch = html.match(/<form[^>]*action=["']([^"']*composer[^"']*)["'][^>]*>(.*?)<\/form>/is);
        if (!formMatch) {
            const anyFormMatch = html.match(/<form[^>]*action=["']([^"']+)["'][^>]*>(.*?name=["']xc_message["'].*?)<\/form>/is);
            if (!anyFormMatch) {
                return { success: false, error: 'Không tìm thấy form đăng bài trên mbasic (Nhóm có thể yêu cầu câu hỏi tham gia hoặc bị chặn đăng).' };
            }
        }

        const actionPath = (formMatch ? formMatch[1] : html.match(/<form[^>]*action=["']([^"']+)["']/i)[1]).replace(/&amp;/g, '&');
        const formInner = formMatch ? formMatch[2] : html;
        const postAction = actionPath.startsWith('http') ? actionPath : `https://mbasic.facebook.com${actionPath}`;

        const formData = new URLSearchParams();
        const inputRegex = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
        let match;
        while ((match = inputRegex.exec(formInner)) !== null) {
            const name = match[1];
            const val = match[2];
            if (name !== 'xc_message' && name !== 'view_post') {
                formData.append(name, val);
            }
        }

        formData.set('xc_message', content);
        formData.set('view_post', 'Đăng');

        // 3. POST bài viết
        const postResp = await fetch(postAction, {
            method: 'POST',
            headers: {
                'User-Agent': USER_AGENT_MOBILE,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookiesString,
                'Referer': mbasicUrl
            },
            body: formData.toString(),
            redirect: 'manual'
        });

        const redirectUrl = postResp.headers.get('location') || '';
        let postHtml = '';
        if (postResp.status === 200) {
            postHtml = await postResp.text();
        }

        let postPermalink = '';
        const targetSearch = redirectUrl || postHtml;

        const permalinkMatch = targetSearch.match(/\/groups\/([^/?#]+)/);
        const permalinkNumberMatch = targetSearch.match(/\/groups\/[^/?#]+\/permalink\/(\d+)/i) ||
                                     targetSearch.match(/\/permalink\/(\d+)/i) ||
                                     targetSearch.match(/story_fbid=(\d+)/i) ||
                                     targetSearch.match(/\/posts\/(\d+)/i);

        if (permalinkNumberMatch) {
            const postIdNum = permalinkNumberMatch[1];
            postPermalink = `https://www.facebook.com/groups/${groupId}/posts/${postIdNum}/`;
        } else {
            postPermalink = `https://www.facebook.com/groups/${groupId}/`;
        }

        const isPending = postHtml.includes('chờ phê duyệt') || postHtml.includes('pending approval');

        return {
            success: true,
            status: isPending ? 'pending_approval' : 'posted',
            postUrl: isPending ? `https://www.facebook.com/groups/${groupId}/pending_posts` : postPermalink,
            message: isPending ? 'Bài viết đã được gửi và đang chờ Quản trị viên duyệt.' : 'Đã đăng bài thành công qua Facebook API!'
        };

    } catch (err) {
        return { success: false, error: `Lỗi đăng bài qua cookie: ${err.message}` };
    }
}

/**
 * Hàm điều phối chung: Ưu tiên Webview -> Fallback qua Cookies
 */
async function executeGroupPost({ webContents, cookies, groupUrl, groupName, content, images }) {
    console.log(`[FB Poster] Bắt đầu đăng bài lên nhóm [${groupName}] (${groupUrl})...`);
    let lastError = '';

    // 1. Ưu tiên đăng qua Facebook Webview nếu có
    if (webContents && !webContents.isDestroyed()) {
        try {
            console.log(`[FB Poster] Sử dụng Facebook Webview để đăng bài vào [${groupName}]...`);
            const wvRes = await postViaWebview(webContents, { groupUrl, content, images });
            if (wvRes.success) {
                return wvRes;
            }
            lastError = wvRes.error || '';
            console.warn(`[FB Poster] Webview đăng chưa thành công: ${wvRes.error}. Đang thử phương án dự phòng...`);
        } catch (e) {
            lastError = e.message || '';
            console.warn(`[FB Poster] Webview gặp lỗi: ${e.message}. Thử phương án dự phòng...`);
        }
    }

    // 2. Dự phòng đăng qua HTTP Cookies (tự động lấy cookie phiên từ webview nếu chưa có)
    let effectiveCookies = cookies;
    if ((!effectiveCookies || effectiveCookies.trim().length <= 10) && webContents && !webContents.isDestroyed() && webContents.session?.cookies) {
        try {
            const sessionCookies = await webContents.session.cookies.get({ domain: '.facebook.com' });
            if (sessionCookies && sessionCookies.length > 0) {
                effectiveCookies = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
            }
        } catch (e) {}
    }

    if (effectiveCookies && effectiveCookies.trim().length > 10) {
        console.log(`[FB Poster] Thử phương án dự phòng Direct Cookies vào [${groupName}]...`);
        const cookieRes = await postViaCookies(effectiveCookies, { groupUrl, content });
        if (cookieRes.success) {
            return cookieRes;
        }
        console.warn(`[FB Poster] Phương án cookie dự phòng cũng không thành công: ${cookieRes.error}`);
    }

    return {
        success: false,
        error: lastError || 'Chưa mở Webview Facebook hoặc tài khoản chưa có quyền đăng bài trong nhóm này.'
    };
}

module.exports = {
    postViaWebview,
    postViaCookies,
    executeGroupPost,
    FB_DOM_POST_SCRIPT
};
