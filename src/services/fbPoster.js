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

        // Hàm kích hoạt sự kiện click toàn diện (Pointer, Mouse, Native) tương thích React 18+
        function clickElement(el) {
            if (!el) return;
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

        // Tự động xử lý pop-up Quy tắc nhóm (Group Rules) hoặc xác nhận câu hỏi
        function handleGroupRulesAndConfirmations() {
            try {
                // Tự động tích checkbox đồng ý nếu có
                const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], div[role="checkbox"]'));
                for (const cb of checkboxes) {
                    const isChecked = cb.checked || cb.getAttribute('aria-checked') === 'true';
                    if (!isChecked && cb.offsetParent !== null) {
                        clickElement(cb);
                    }
                }

                // Tìm nút "Đồng ý" / "Gửi" / "Submit" trong các dialog xác nhận
                const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
                for (const d of dialogs) {
                    const dText = (d.innerText || '').toLowerCase();
                    if (dText.includes('quy tắc nhóm') || dText.includes('group rules') || dText.includes('trước khi đăng bài') || dText.includes('before you post')) {
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

        // Tự động chuyển sang tab "Thảo luận" (Discussion) nếu nhóm là dạng Buy/Sell (Mua bán)
        function switchToDiscussionTab() {
            try {
                const candidates = Array.from(document.querySelectorAll('a[role="tab"], div[role="tab"], span, div[role="button"]'));
                for (const el of candidates) {
                    if (el.offsetParent === null) continue;
                    const text = (el.innerText || el.textContent || '').trim().toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
                    if (text === 'thảo luận' || text === 'discussion' || aria === 'thảo luận' || aria === 'discussion' ||
                        text === 'bắt đầu cuộc thảo luận' || text === 'start discussion' || text === 'tạo bài viết thảo luận') {
                        const tabBtn = el.closest('[role="tab"]') || el.closest('[role="button"]') || el;
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

        // 1. Kiểm tra nếu bị chuyển hướng về trang đăng nhập
        if (window.location.href.includes('/login') || window.location.href.includes('checkpoint')) {
            return { success: false, error: 'Chưa đăng nhập Facebook hoặc phiên đã hết hạn. Hãy đăng nhập lại trong tab Facebook Web.' };
        }

        // Giải quyết sớm popup quy tắc nhóm hoặc chuyển tab thảo luận nếu có
        handleGroupRulesAndConfirmations();
        switchToDiscussionTab();

        // 2. Tìm nút mở khung soạn bài (Composer Trigger)
        const triggerKeywords = [
            'bạn viết gì đi',
            'tạo bài viết công khai',
            'tạo bài viết',
            'bạn đang nghĩ gì',
            'write something',
            'create a public post',
            'create a post',
            'what\\'s on your mind',
            'bắt đầu cuộc thảo luận',
            'start discussion',
            'thảo luận',
            'discussion'
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
            clickElement(triggerBtn);
        }

        // 3. Chờ Dialog tạo bài viết xuất hiện
        let postDialog = null;
        let editor = null;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 400));
            editor = document.querySelector(
                'div[role="dialog"] div[data-lexical-editor="true"], ' +
                'div[role="dialog"] div[role="textbox"][contenteditable="true"], ' +
                'div[role="dialog"] div[contenteditable="true"], ' +
                'div[role="dialog"] div[aria-label*="Tạo bài viết"], ' +
                'div[role="dialog"] div[aria-label*="viết gì"], ' +
                'div[role="dialog"] div[aria-label*="write something"], ' +
                'div[data-pagelet="GroupInlineComposer"] div[contenteditable="true"], ' +
                'div[role="textbox"][contenteditable="true"]'
            );
            if (editor && editor.offsetParent !== null) {
                postDialog = editor.closest('div[role="dialog"]') || document.querySelector('div[role="dialog"]');
                break;
            }
        }

        if (!editor) {
            return { success: false, error: 'Không mở được khung soạn thảo bài viết của Facebook.' };
        }

        // 4. Nhập nội dung bài viết vào editor
        clickElement(editor);
        editor.focus();
        await new Promise(r => setTimeout(r, 200));

        // Đặt con trỏ vào bên trong editor
        try {
            const sel = window.getSelection();
            if (sel) {
                const range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        } catch (e) {}

        // Nhập từng dòng bằng execCommand ('insertText' và 'insertParagraph' cho xuống dòng)
        // Kích hoạt chuẩn xác cơ chế soạn thảo của Lexical / React 18 trên Facebook
        let insertedAny = false;
        try {
            const lines = textToPost.split(/\r?\n/);
            for (let li = 0; li < lines.length; li++) {
                const curLine = lines[li];
                if (curLine.length > 0) {
                    const ok = document.execCommand('insertText', false, curLine);
                    if (ok) insertedAny = true;
                }
                if (li < lines.length - 1) {
                    document.execCommand('insertParagraph', false, null);
                }
            }
        } catch (e) {
            console.warn('[FB DOM] Lỗi execCommand insertText:', e);
        }

        // Dự phòng nếu execCommand không chèn được chữ
        if (!editor.innerText || !editor.innerText.trim()) {
            try {
                editor.dispatchEvent(new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: textToPost
                }));
            } catch (e) {}
        }

        // Kích hoạt toàn bộ sự kiện input để React đồng bộ state và làm sáng nút Đăng
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' }));
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));

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

        // 5. Tìm nút "Đăng" / "Post" / "Gửi" / "Submit"
        const submitKeywords = [
            'đăng', 'post', 'gửi', 'submit', 'chia sẻ', 'share',
            'gửi bài viết', 'submit post', 'tiếp', 'next', 'xác nhận', 'confirm',
            'publish', 'xuất bản', 'đăng bài viết', 'post to group', 'tạo bài viết', 'done', 'xong'
        ];

        function findSubmitButton() {
            const searchContexts = [postDialog, document.querySelector('div[role="dialog"]'), document].filter(Boolean);
            for (const ctx of searchContexts) {
                const buttons = Array.from(ctx.querySelectorAll('div[role="button"], button, [type="submit"]'));
                for (let i = buttons.length - 1; i >= 0; i--) {
                    const b = buttons[i];
                    if (b.offsetParent === null) continue;
                    const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
                    const text = (b.innerText || b.textContent || '').trim().toLowerCase();
                    const isDisabled = b.getAttribute('aria-disabled') === 'true' || b.disabled || b.classList.contains('disabled');

                    for (const kw of submitKeywords) {
                        if ((aria === kw || text === kw || aria.startsWith(kw) || text.startsWith(kw) || aria.includes(kw) || text.includes(kw)) && !isDisabled) {
                            return b;
                        }
                    }
                }
            }
            return null;
        }

        let submitBtn = null;
        for (let i = 0; i < 35; i++) {
            handleGroupRulesAndConfirmations();
            submitBtn = findSubmitButton();
            if (submitBtn) break;

            // Nếu nút chưa mở hoặc còn mờ, kích thích editor bằng Lexical input event để Facebook cập nhật state
            if (editor && i % 3 === 0) {
                try {
                    editor.focus();
                    editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ' ' }));
                    editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ' ' }));
                    document.execCommand('insertText', false, ' ');
                    document.execCommand('delete', false, null);
                } catch (e) {}
            }
            await new Promise(r => setTimeout(r, 400));
        }

        if (!submitBtn) {
            return { success: false, error: 'Không tìm thấy nút "Đăng" hoặc "Gửi" khả dụng (Nút Đăng có thể đang bị mờ do tài khoản bị giới hạn hoặc ảnh tải chưa xong).' };
        }

        // Bấm nút Đăng
        clickElement(submitBtn);

        // 6. Chờ Facebook xử lý đăng bài (Chờ dialog đóng hoặc toast hiển thị)
        let isPosted = false;
        let isPendingApproval = false;
        const waitSubmitStart = Date.now();

        while (Date.now() - waitSubmitStart < 40000) {
            await new Promise(r => setTimeout(r, 1000));

            // Tự động giải quyết popup quy tắc nhóm
            handleGroupRulesAndConfirmations();

            const bodyText = (document.body.innerText || '').toLowerCase();

            // A. Dấu hiệu bài đang chờ Quản trị viên duyệt
            const pendingKeywords = [
                'chờ quản trị viên phê duyệt',
                'đang chờ phê duyệt',
                'quản trị viên sẽ phê duyệt',
                'chờ phê duyệt',
                'đã gửi bài viết cho quản trị viên',
                'bài viết của bạn đã được gửi',
                'bài viết đang chờ',
                'pending approval',
                'submitted for approval',
                'waiting for approval',
                'must be approved by an admin',
                'admin must approve',
                'post has been submitted'
            ];
            for (const kw of pendingKeywords) {
                if (bodyText.includes(kw)) {
                    isPendingApproval = true;
                    isPosted = true;
                    break;
                }
            }
            if (isPosted) break;

            // B. Dấu hiệu đăng thành công (Toast / Notification)
            const successKeywords = [
                'đã đăng bài viết của bạn',
                'bài viết của bạn đã được đăng',
                'đã chia sẻ bài viết',
                'bài viết của bạn hiện đã hiển thị',
                'your post was shared',
                'your post has been published',
                'your post is now published',
                'post published'
            ];
            for (const skw of successKeywords) {
                if (bodyText.includes(skw)) {
                    isPosted = true;
                    break;
                }
            }
            if (isPosted) break;

            // C. Dấu hiệu lỗi spam / chặn quyền
            if (bodyText.includes('bạn tạm thời bị chặn') || bodyText.includes('you\\'re temporarily blocked') || bodyText.includes('hành động bị chặn')) {
                return { success: false, error: 'Facebook tạm thời chặn tài khoản đăng bài vào nhóm này (Spam filter).' };
            }
            if (bodyText.includes('bạn không thể đăng bài trong nhóm này') || bodyText.includes('you can\\'t post to this group')) {
                return { success: false, error: 'Tài khoản không có quyền đăng bài trong nhóm này.' };
            }

            // D. Kiểm tra xem Post Dialog đã ĐÓNG THỰC SỰ hay chưa (tránh bị lừa bởi Messenger dock)
            let isTargetDialogClosed = true;
            if (postDialog && document.body.contains(postDialog)) {
                try {
                    const isVisible = postDialog.offsetParent !== null && 
                                     postDialog.getAttribute('aria-hidden') !== 'true' &&
                                     window.getComputedStyle(postDialog).display !== 'none' &&
                                     window.getComputedStyle(postDialog).visibility !== 'hidden';
                    isTargetDialogClosed = !isVisible;
                } catch (e) {
                    isTargetDialogClosed = true;
                }
            }

            const isEditorGone = !editor || !document.body.contains(editor) || editor.offsetParent === null;

            if (isTargetDialogClosed || isEditorGone) {
                isPosted = true;
                break;
            }

            // E. Nếu sau 6 giây mà nút Submit vẫn còn khả dụng và chưa bị vô hiệu hóa, thử click lại
            if (Date.now() - waitSubmitStart > 6000 && Math.floor((Date.now() - waitSubmitStart) / 1000) % 5 === 0) {
                const retryBtn = findSubmitButton();
                if (retryBtn) {
                    clickElement(retryBtn);
                }
            }
        }

        if (!isPosted) {
            // Kiểm tra xem có thông báo lỗi cụ thể nào bên trong dialog không
            const dText = postDialog ? (postDialog.innerText || '').trim() : '';
            if (dText.includes('lỗi') || dText.includes('error') || dText.includes('không thể') || dText.includes('failed')) {
                const errSnippet = dText.substring(0, 150).replace(/\\s+/g, ' ');
                return { success: false, error: 'Facebook báo lỗi: ' + errSnippet };
            }
            return { success: false, error: 'Hết thời gian chờ Facebook xử lý đăng bài (Có thể nhóm yêu cầu trả lời câu hỏi thành viên hoặc kiểm duyệt).' };
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

    // 2. Dự phòng đăng qua HTTP Cookies (Tự động trích xuất cookie phiên từ chính Webview nếu cần)
    let effectiveCookies = cookies;
    if ((!effectiveCookies || effectiveCookies.trim().length <= 10) && webContents && !webContents.isDestroyed() && webContents.session?.cookies) {
        try {
            const sessionCookies = await webContents.session.cookies.get({ domain: '.facebook.com' });
            if (sessionCookies && sessionCookies.length > 0) {
                effectiveCookies = sessionCookies.map(c => `${c.name}=${c.value}`).join('; ');
            }
        } catch (e) {
            console.warn('[FB Poster] Không thể trích xuất cookie từ Webview session:', e.message);
        }
    }

    if (effectiveCookies && effectiveCookies.trim().length > 10) {
        console.log(`[FB Poster] Sử dụng Direct Cookies để đăng bài vào [${groupName}]...`);
        const cookieRes = await postViaCookies(effectiveCookies, { groupUrl, content });
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
