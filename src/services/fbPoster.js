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
        const textToPost = ${JSON.stringify(content)};
        const imagesToUpload = ${JSON.stringify(imagesData || [])};
        const startTime = Date.now();

        // 1. Kiểm tra nếu bị chuyển hướng về trang đăng nhập
        if (window.location.href.includes('/login') || window.location.href.includes('checkpoint')) {
            return { success: false, error: 'Chưa đăng nhập Facebook hoặc phiên đã hết hạn. Hãy đăng nhập lại trong tab Facebook Web.' };
        }

        // 2. Tìm nút mở khung soạn bài (Composer Trigger)
        const triggerKeywords = [
            'bạn viết gì đi',
            'tạo bài viết công khai',
            'tạo bài viết',
            'bạn đang nghĩ gì',
            'write something',
            'create a public post',
            'create a post',
            'what\\'s on your mind'
        ];

        function findComposerTrigger() {
            const elements = Array.from(document.querySelectorAll('span, div[role="button"], div[tabindex="0"]'));
            for (const el of elements) {
                const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                for (const kw of triggerKeywords) {
                    if (text === kw || (text.includes(kw) && text.length < 50) || aria.includes(kw)) {
                        const btn = el.closest('[role="button"]') || el.closest('[tabindex="0"]') || el;
                        if (btn && btn.offsetParent !== null) return btn;
                    }
                }
            }
            return document.querySelector('div[role="region"] div[role="button"], div[data-pagelet="GroupInlineComposer"] div[role="button"]');
        }

        let triggerBtn = null;
        for (let i = 0; i < 20; i++) {
            triggerBtn = findComposerTrigger();
            if (triggerBtn) break;
            await new Promise(r => setTimeout(r, 500));
        }

        if (!triggerBtn) {
            // Kiểm tra xem dialog đã mở sẵn chưa
            if (!document.querySelector('div[role="dialog"]')) {
                return { success: false, error: 'Không tìm thấy khung tạo bài viết trong nhóm này (Có thể bạn chưa được duyệt vào nhóm hoặc nhóm đã khóa đăng bài).' };
            }
        } else {
            triggerBtn.click();
        }

        // 3. Chờ Dialog tạo bài viết xuất hiện
        let dialog = null;
        let editor = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 400));
            dialog = document.querySelector('div[role="dialog"]');
            const searchContext = dialog || document;
            editor = searchContext.querySelector('div[role="textbox"][contenteditable="true"], div[contenteditable="true"]');
            if (editor && editor.offsetParent !== null) break;
        }

        if (!editor) {
            return { success: false, error: 'Không mở được khung soạn thảo bài viết của Facebook.' };
        }

        // 4. Nhập nội dung bài viết vào editor
        editor.focus();
        await new Promise(r => setTimeout(r, 200));

        let inserted = false;
        try {
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            inserted = document.execCommand('insertText', false, textToPost);
        } catch (e) {}

        if (!inserted || !editor.innerText.trim()) {
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
        }

        if (!editor.innerText.trim()) {
            editor.textContent = textToPost;
        }

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 600));

        // 4.1 Đính kèm hình ảnh vào bài viết (nếu có)
        if (Array.isArray(imagesToUpload) && imagesToUpload.length > 0) {
            console.log('[FB DOM] Bắt đầu đính kèm ' + imagesToUpload.length + ' ảnh vào bài viết...');
            
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
                } catch (e) {
                    console.error('[FB DOM] Lỗi chuyển đổi file:', e);
                }
            }

            if (domFiles.length > 0) {
                const dialogCtx = document.querySelector('div[role="dialog"]') || document;
                
                // Tìm nút "Ảnh/video" trong hộp thoại soạn thảo
                const photoBtnSelectors = [
                    'div[aria-label*="Ảnh/video"]',
                    'div[aria-label*="Photo/video"]',
                    'div[aria-label*="Ảnh/Video"]',
                    'div[aria-label*="Thêm ảnh"]',
                    'div[aria-label*="Add Photo"]',
                    'div[aria-label="Ảnh"]',
                    'div[aria-label="Photo"]',
                    'div[aria-label*="Thêm vào bài viết"] div[role="button"]'
                ];
                
                let fileInput = dialogCtx.querySelector('input[type="file"][accept*="image"], input[type="file"]');
                if (!fileInput) {
                    for (const s of photoBtnSelectors) {
                        const btn = dialogCtx.querySelector(s);
                        if (btn && btn.offsetParent !== null) {
                            btn.click();
                            await new Promise(r => setTimeout(r, 800));
                            fileInput = dialogCtx.querySelector('input[type="file"][accept*="image"], input[type="file"]');
                            if (fileInput) break;
                        }
                    }
                }

                let attached = false;
                if (fileInput) {
                    try {
                        const dt = new DataTransfer();
                        domFiles.forEach(f => dt.items.add(f));
                        fileInput.files = dt.files;
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
                        attached = true;
                        console.log('[FB DOM] Đã gán ' + domFiles.length + ' file vào fileInput!');
                    } catch (e) {
                        console.warn('[FB DOM] Lỗi gán fileInput.files:', e);
                    }
                }

                // Luôn kích hoạt thêm sự kiện dán file (Clipboard paste) lên editor để đảm bảo 100%
                try {
                    const pasteDt = new DataTransfer();
                    domFiles.forEach(f => pasteDt.items.add(f));
                    editor.dispatchEvent(new ClipboardEvent('paste', {
                        clipboardData: pasteDt,
                        bubbles: true,
                        cancelable: true
                    }));
                } catch (e) {}

                // Chờ Facebook tải ảnh lên CDN và hiển thị preview (tối đa 25 giây)
                console.log('[FB DOM] Đang chờ Facebook xử lý và tải ảnh lên...');
                for (let w = 0; w < 50; w++) {
                    await new Promise(r => setTimeout(r, 500));
                    const imgThumbnails = dialogCtx.querySelectorAll('img[src^="blob:"], img[src*="fbcdn"], [aria-label*="Ảnh"], [role="img"]');
                    const sb = findSubmitButton();
                    // Khi đã có ảnh hiển thị trong khung và nút Đăng không bị disabled
                    if (imgThumbnails.length > 0 && sb && !sb.disabled && sb.getAttribute('aria-disabled') !== 'true') {
                        console.log('[FB DOM] Ảnh đã được tải lên thành công và nút Đăng đã sẵn sàng!');
                        break;
                    }
                }
            }
        }

        // 5. Tìm nút "Đăng" / "Post"
        function findSubmitButton() {
            const searchContext = document.querySelector('div[role="dialog"]') || document;
            const buttons = Array.from(searchContext.querySelectorAll('div[role="button"], button'));
            for (const b of buttons) {
                const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                const isDisabled = b.getAttribute('aria-disabled') === 'true' || b.disabled;

                if ((aria === 'đăng' || aria === 'post' || text === 'đăng' || text === 'post') && !isDisabled) {
                    return b;
                }
            }
            return null;
        }

        let submitBtn = null;
        for (let i = 0; i < 15; i++) {
            submitBtn = findSubmitButton();
            if (submitBtn) break;
            await new Promise(r => setTimeout(r, 300));
        }

        if (!submitBtn) {
            return { success: false, error: 'Không tìm thấy nút "Đăng" khả dụng (Nội dung có thể chưa hợp lệ).' };
        }

        // Bấm nút Đăng
        submitBtn.click();

        // 6. Chờ Facebook xử lý đăng bài (Chờ dialog đóng hoặc toast hiển thị)
        let isPosted = false;
        let isPendingApproval = false;
        const waitSubmitStart = Date.now();

        while (Date.now() - waitSubmitStart < 35000) {
            await new Promise(r => setTimeout(r, 1000));

            // Kiểm tra thông báo chờ duyệt
            const bodyText = (document.body.innerText || '').toLowerCase();
            if (bodyText.includes('chờ quản trị viên phê duyệt') || 
                bodyText.includes('đang chờ phê duyệt') || 
                bodyText.includes('pending approval') || 
                bodyText.includes('submitted for approval')) {
                isPendingApproval = true;
                isPosted = true;
                break;
            }

            // Kiểm tra thông báo lỗi checkpoint hoặc spam
            if (bodyText.includes('bạn tạm thời bị chặn') || bodyText.includes('you\\'re temporarily blocked')) {
                return { success: false, error: 'Facebook tạm thời chặn tài khoản đăng bài vào nhóm (Spam filter).' };
            }

            // Dialog đã đóng chứng tỏ bài đã gửi thành công
            const curDialog = document.querySelector('div[role="dialog"]');
            if (!curDialog) {
                isPosted = true;
                break;
            }
        }

        if (!isPosted) {
            return { success: false, error: 'Hết thời gian chờ Facebook xử lý đăng bài.' };
        }

        // Đợi thêm 2 giây để Facebook render bài viết lên đầu trang
        await new Promise(r => setTimeout(r, 2000));

        // 7. Bóc tách Link bài viết (Permalink)
        function extractLatestPostLink() {
            const currentUrl = window.location.href;
            const groupMatch = currentUrl.match(/\\/groups\\/([^/?#]+)/);
            const groupId = groupMatch ? groupMatch[1] : '';

            // Quét các thẻ a có chứa liên kết bài viết
            const links = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="permalink.php"], a[href*="multi_permalinks"]'));
            for (const a of links) {
                const href = a.getAttribute('href') || '';
                const text = (a.innerText || a.textContent || '').trim().toLowerCase();

                // Dấu hiệu bài viết vừa đăng: Chứa "Vừa xong", "Just now", "1 phút", "1 min" hoặc nằm ở đầu feed
                const isJustNow = text.includes('vừa xong') || text.includes('just now') || text.includes('1 phút') || text.includes('1 min') || text.includes('giây');

                if (href.includes('/posts/') || href.includes('/permalink/')) {
                    let cleanHref = href.split('?')[0];
                    if (cleanHref.startsWith('/')) {
                        cleanHref = 'https://www.facebook.com' + cleanHref;
                    }
                    if (isJustNow) {
                        return cleanHref;
                    }
                }
            }

            // Nếu có link bài viết nào khớp với groupId thì lấy link đầu tiên
            for (const a of links) {
                const href = a.getAttribute('href') || '';
                if (href.includes('/posts/') || href.includes('/permalink/')) {
                    let cleanHref = href.split('?')[0];
                    if (cleanHref.startsWith('/')) {
                        cleanHref = 'https://www.facebook.com' + cleanHref;
                    }
                    if (groupId && cleanHref.includes(groupId)) {
                        return cleanHref;
                    }
                }
            }

            return null;
        }

        const postLink = extractLatestPostLink();
        const curGroupUrl = window.location.href.split('?')[0];

        if (isPendingApproval) {
            return {
                success: true,
                status: 'pending_approval',
                postUrl: curGroupUrl.replace(/\\/?$/, '/pending_posts'),
                message: 'Bài viết đã được gửi và đang chờ Quản trị viên duyệt.'
            };
        }

        return {
            success: true,
            status: 'posted',
            postUrl: postLink || curGroupUrl,
            message: postLink ? 'Đã đăng bài thành công lên Facebook!' : 'Đã đăng bài thành công (Đang hiển thị trên Bảng Tin nhóm).'
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
                resolve(); // Tiếp tục dù timeout loadURL
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
            // Thử tìm form bất kỳ có textarea
            const anyFormMatch = html.match(/<form[^>]*action=["']([^"']+)["'][^>]*>(.*?name=["']xc_message["'].*?)<\/form>/is);
            if (!anyFormMatch) {
                return { success: false, error: 'Không tìm thấy form đăng bài trên mbasic (Nhóm có thể yêu cầu câu hỏi tham gia hoặc bị chặn đăng).' };
            }
        }

        const actionPath = (formMatch ? formMatch[1] : html.match(/<form[^>]*action=["']([^"']+)["']/i)[1]).replace(/&amp;/g, '&');
        const formInner = formMatch ? formMatch[2] : html;
        const postAction = actionPath.startsWith('http') ? actionPath : `https://mbasic.facebook.com${actionPath}`;

        // Trích xuất hidden inputs
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

        // Bóc tách link bài viết từ redirect URL hoặc trang kết quả
        let postPermalink = '';
        const targetSearch = redirectUrl || postHtml;

        const permalinkMatch = targetSearch.match(/\/groups\/[^/?#]+\/permalink\/(\d+)/i) ||
                               targetSearch.match(/\/permalink\/(\d+)/i) ||
                               targetSearch.match(/story_fbid=(\d+)/i) ||
                               targetSearch.match(/\/posts\/(\d+)/i);

        if (permalinkMatch) {
            const postIdNum = permalinkMatch[1];
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

    // 2. Dự phòng đăng qua HTTP Cookies
    if (cookies && cookies.trim().length > 10) {
        console.log(`[FB Poster] Sử dụng Direct Cookies để đăng bài vào [${groupName}]...`);
        const cookieRes = await postViaCookies(cookies, { groupUrl, content });
        return cookieRes;
    }

    return {
        success: false,
        error: lastError || 'Chưa mở Webview Facebook và không tìm thấy Cookie Facebook hợp lệ để đăng bài.'
    };
}

module.exports = {
    postViaWebview,
    postViaCookies,
    executeGroupPost,
    FB_DOM_POST_SCRIPT
};
