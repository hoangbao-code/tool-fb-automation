const { dbAsync } = require('../db');
const { isChromeDebuggingActive, sendPromptToChromeGemini, launchChromeGemini, DEFAULT_PORT } = require('./chromeGemini');

function cleanGeminiOutput(text) {
    if (!text) return '';
    let clean = text.trim();
    
    // Bỏ markdown codeblocks nếu có ```markdown ... ```
    clean = clean.replace(/^```(?:markdown|text)?\s*\n/i, '').replace(/\n```\s*$/i, '');

    // Bỏ dòng mở đầu kiểu chào hỏi / nhận xét / filler
    const introPatterns = [
        /^(dưới đây là|đây là|chào bạn|sau đây là|gợi ý bài đăng|bài viết được viết lại|tuyệt vời|rất vui|tôi sẽ).*?:\s*\n+/i,
        /^(dưới đây là|đây là|chào bạn|sau đây là|tuyệt vời|tuyệt vời!).*?!\s*\n+/i,
        /^---\s*\n+/
    ];
    for (const pat of introPatterns) {
        clean = clean.replace(pat, '');
    }

    // Bỏ dòng kết thúc kiểu chào tạm biệt / hy vọng
    clean = clean.replace(/\n+(hy vọng bài viết|chúc bạn|nếu bạn cần|lưu ý|mong bài viết|bài viết này được viết).*?$/i, '');
    clean = clean.replace(/\n+---\s*$/i, '');
    
    return clean.trim();
}

/**
 * Gọi Google Gemini API với cơ chế tự động chuyển đổi mô hình dự phòng (Auto-Fallback)
 */
async function callGeminiApi(apiKey, requestedModel, prompt) {
    let cleanModel = requestedModel?.trim() || 'gemini-3.7-flash';
    if (cleanModel === 'gemini-2.0-flash' || cleanModel === 'gemini-1.5-flash') {
        cleanModel = 'gemini-3.7-flash';
    }

    // Danh sách các mô hình hoạt động ổn định nhất trên Google AI Studio (ưu tiên 3.7-flash, 3.8-flash, 2.5-flash)
    const modelsToTry = [cleanModel];
    const candidateList = ['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.6-flash'];
    for (const cand of candidateList) {
        if (!modelsToTry.includes(cand)) modelsToTry.push(cand);
    }

    let lastError = null;
    for (let i = 0; i < modelsToTry.length; i++) {
        const curModel = modelsToTry[i];
        const isLast = (i === modelsToTry.length - 1);
        try {
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(curModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(15000),
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 2048
                    }
                })
            });

            if (response.ok) {
                const data = await response.json();
                const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (resultText) {
                    return { text: resultText.trim(), modelUsed: curModel };
                }
            }

            const errText = await response.text();
            lastError = new Error(`Lỗi từ Gemini API (${response.status}): ${errText}`);
            
            const shouldFallback = response.status === 503 
                || response.status === 429 
                || response.status === 404 
                || response.status >= 500
                || errText.includes('high demand') 
                || errText.includes('UNAVAILABLE') 
                || errText.includes('no longer available') 
                || errText.includes('NOT_FOUND');

            if (shouldFallback && !isLast) {
                const nextModel = modelsToTry[i + 1];
                console.warn(`[Gemini API] Model ${curModel} gặp sự cố (${response.status} - Quá tải/Bận), đang tự động chuyển sang ${nextModel}...`);
                await new Promise(r => setTimeout(r, 400));
                continue;
            } else {
                throw lastError;
            }
        } catch (err) {
            lastError = err;
            const msg = err.message || '';
            const isRecoverable = msg.includes('503') 
                || msg.includes('429') 
                || msg.includes('404') 
                || msg.includes('high demand') 
                || msg.includes('UNAVAILABLE') 
                || msg.includes('no longer available');

            if (isRecoverable && !isLast) {
                await new Promise(r => setTimeout(r, 400));
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

/**
 * Gửi nội dung tin nhắn phòng thô trực tiếp vào Google Chrome Gemini Web
 * Chờ AI trên Chrome hoàn tất biên tập, làm sạch và trả về bài viết đã viết lại.
 * Hỗ trợ tùy chọn ngôn ngữ Tiếng Anh (en) hoặc Tiếng Việt (vi).
 */
async function rewriteWithGemini(content, sender = '', groupName = '', overridePrompt = null, language = null) {
    if (!content || !content.trim()) {
        throw new Error('Nội dung tin nhắn trống, không thể gửi sang Gemini AI.');
    }

    const rawText = content.trim();

    // Xác định ngôn ngữ mục tiêu (mặc định lấy từ settings nếu không chỉ định)
    let targetLang = language;
    if (!targetLang) {
        try {
            const langRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_default_language'`);
            targetLang = langRow?.value?.trim() || 'vi';
        } catch (e) {
            targetLang = 'vi';
        }
    }

    let promptToSend = rawText;
    if (overridePrompt) {
        promptToSend = overridePrompt.replace('{CONTENT}', rawText);
        if (targetLang === 'en' && !promptToSend.toLowerCase().includes('english')) {
            promptToSend = `[YÊU CẦU: Viết bài đăng hoàn toàn bằng TIẾNG ANH (English) chuyên nghiệp, thu hút khách nước ngoài / expat]\n\n` + promptToSend;
        }
    } else {
        if (targetLang === 'en') {
            promptToSend = `[YÊU CẦU: Hãy dịch và viết lại bài đăng sau đây thành bài đăng Facebook hoàn toàn bằng TIẾNG ANH (English) chuyên nghiệp, thu hút khách thuê người nước ngoài / expat. Giữ đúng toàn bộ thông tin quan trọng (giá thuê, diện tích, địa chỉ/quận, tiện ích, số điện thoại Zalo liên hệ), thêm emoji sinh động và hashtag tiếng Anh phù hợp như #saigonapartment #expat #apartmentforrent #hcmc. Không thêm lời chào hay giải thích, chỉ xuất ra nội dung bài viết.]\n\nNội dung gốc:\n${rawText}`;
        } else {
            promptToSend = `[YÊU CẦU: Hãy viết lại bài đăng sau đây thành một bài đăng Facebook chuyên nghiệp bằng TIẾNG VIỆT, hấp dẫn, giữ đúng toàn bộ thông tin quan trọng (giá, diện tích, địa chỉ, số điện thoại liên hệ), có thêm icon sinh động và hashtag liên quan. Không thêm lời chào hay giải thích, chỉ xuất ra nội dung bài viết.]\n\nNội dung gốc:\n${rawText}`;
        }
    }

    // Lấy cấu hình URL cuộc trò chuyện đã ghim từ settings
    const targetUrlRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_conversation_url'`);
    const targetUrl = targetUrlRow?.value?.trim() || null;

    let chromeStatus = await isChromeDebuggingActive();

    // Nếu Chrome chưa chạy -> TỰ ĐỘNG KHỞI CHẠY GOOGLE CHROME với cuộc trò chuyện đã ghim!
    if (!chromeStatus.active) {
        console.log('[Gemini Web] Chrome chưa chạy, đang tự động khởi chạy Chrome...');
        await dbAsync.log('info', `[Gemini Web] Đang tự động mở Google Chrome để biên tập tin từ [${groupName || 'Zalo'}] (${targetLang === 'en' ? 'Tiếng Anh' : 'Tiếng Việt'})...`);
        const launchRes = await launchChromeGemini(DEFAULT_PORT, targetUrl);
        if (launchRes.success) {
            chromeStatus = { active: true };
            // Chờ Chrome nạp trang và ổn định
            await new Promise(r => setTimeout(r, 4000));
        } else {
            // Kiểm tra xem người dùng có API Key dự phòng không
            const apiKeyRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
            if (apiKeyRow?.value && apiKeyRow.value.trim()) {
                console.log('[Gemini Web] Không thể mở Chrome, tự động chuyển sang Gemini API dự phòng...');
                const modelRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_model'`);
                const apiRes = await callGeminiApi(apiKeyRow.value.trim(), modelRow?.value || 'gemini-3.7-flash', promptToSend);
                return cleanGeminiOutput(apiRes.text);
            }
            throw new Error(`Không thể khởi chạy Google Chrome: ${launchRes.message}. Vui lòng kiểm tra xem Chrome đã được cài đặt chưa.`);
        }
    }

    let resultTextRaw = '';

    console.log(`[Gemini Web] Đang gửi yêu cầu biên tập (${targetLang === 'en' ? 'Tiếng Anh' : 'Tiếng Việt'}) vào Gemini Web...`);
    const chromeRes = await sendPromptToChromeGemini(promptToSend, DEFAULT_PORT, targetUrl);

    if (chromeRes.success && chromeRes.text) {
        resultTextRaw = chromeRes.text;

        // Tự động lưu URL hội thoại chính thức (/app/<id>) nếu người dùng bắt đầu từ link share
        if (chromeRes.finalUrl && (chromeRes.finalUrl.includes('/app/') || chromeRes.finalUrl.includes('/gem/')) && chromeRes.finalUrl !== targetUrl) {
            dbAsync.run(`UPDATE settings SET value = ? WHERE key = 'gemini_conversation_url'`, [chromeRes.finalUrl])
                .catch(e => console.warn('[Gemini Web] Không thể lưu finalUrl:', e.message));
        }
    } else {
        const errorMsg = chromeRes.error || 'Gemini Web không trả về phản hồi bài viết.';
        console.warn('[Gemini Web] Lỗi:', errorMsg);
        throw new Error(`Google Chrome Gemini: ${errorMsg}`);
    }

    let resultText = cleanGeminiOutput(resultTextRaw);

    // Tự động chèn thông tin liên hệ (chữ ký) nếu có và chưa có trong bài
    const sigRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'custom_signature'`);
    if (sigRow?.value && sigRow.value.trim()) {
        const sig = sigRow.value.trim();
        const phoneMatch = sig.match(/\d{9,11}/);
        const hasPhoneAlready = phoneMatch && resultText.includes(phoneMatch[0]);
        if (!hasPhoneAlready && !resultText.includes(sig)) {
            resultText += `\n\n${sig}`;
        }
    }

    // Tự động chèn dàn Hashtags cá nhân nếu có và chưa có trong bài
    const tagRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'custom_hashtags'`);
    if (tagRow?.value && tagRow.value.trim()) {
        const customTags = tagRow.value.trim();
        if (!resultText.includes(customTags)) {
            resultText += `\n\n${customTags}`;
        }
    }

    await dbAsync.log('info', `Gemini Web đã biên tập xong bài viết cho [${groupName || 'Zalo'}] bằng ${targetLang === 'en' ? 'Tiếng Anh' : 'Tiếng Việt'} (${resultText.length} ký tự).`);
    return resultText.trim();
}

/**
 * Kiểm tra xem bài viết hoặc nhóm đích có phải bằng Tiếng Anh / Dành cho Expat hay không
 */
function isEnglishPost(content = '', groupName = '') {
    const combined = (content + ' ' + groupName).toLowerCase();
    const expatPatterns = [
        'expat', 'foreigner', 'apartment for rent', 'room for rent',
        'living in ho chi minh', 'saigon apartment', 'district 1', 'district 2',
        'district 7', 'thao dien', 'luxury apartment', 'western', 'studio for rent'
    ];
    for (const p of expatPatterns) {
        if (combined.includes(p)) return true;
    }
    const vietnameseAccents = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
    if (!vietnameseAccents.test(content) && content.length > 50) {
        const enWords = ['apartment', 'bedroom', 'bathroom', 'balcony', 'fully furnished', 'rent', 'deposit', 'contact', 'location', 'amenities'];
        let enCount = 0;
        for (const w of enWords) {
            if (combined.includes(w)) enCount++;
        }
        if (enCount >= 2) return true;
    }
    return false;
}

/**
 * Tạo biến thể bài viết riêng biệt (Unique Spin Content) cho từng nhóm Facebook
 * để tránh thuật toán chống spam trùng lặp của Facebook.
 * Tự động chọn câu mở đầu và CTA bằng Tiếng Anh hoặc Tiếng Việt phù hợp với bài viết!
 */
function spinPostForGroup(baseContent, targetGroupName = '', index = 0) {
    if (!baseContent) return '';

    const isEn = isEnglishPost(baseContent, targetGroupName);

    const hooks = isEn ? [
        `📢 NEW UPDATE:`,
        `✨ HOT LISTING TODAY:`,
        `🌟 AVAILABLE NOW:`,
        `💎 NEW APARTMENT FOR RENT:`,
        `📌 HIGHLIGHTED PROPERTY:`,
        `🚀 EXCELLENT DEAL:`
    ] : [
        `📢 CẬP NHẬT MỚI:`,
        `🔥 TIN HOT HÔM NAY:`,
        `✨ DÀNH CHO ANH EM QUAN TÂM:`,
        `💎 SIÊU PHẨM MỚI LÊN SÓNG:`,
        `📌 THÔNG TIN ĐÁNG CHÚ Ý:`,
        `🚀 CHIA SẺ CÙNG CẢ NHÀ:`
    ];

    const ctas = isEn ? [
        `👉 Interested? Send a direct message or call for viewing!`,
        `📞 Call / Zalo / WhatsApp for fast viewing & consultation:`,
        `🤝 Schedule your viewing today — feel free to inbox anytime!`,
        `⚡ Move-in ready! Contact us now to reserve this unit!`
    ] : [
        `👉 Mọi người quan tâm inbox hoặc liên hệ ngay nhé!`,
        `📞 Xem chi tiết thông tin bên dưới hoặc liên hệ trực tiếp:`,
        `🤝 Hỗ trợ tư vấn và giải đáp nhiệt tình cho anh em:`,
        `⚡ Bác nào ưng ý nhắn tin ngay để giữ chỗ sớm nhé!`
    ];

    const chosenHook = hooks[index % hooks.length];
    const chosenCta = ctas[index % ctas.length];

    // Gắn biến thể nhẹ vào đầu bài và giữ trọn vẹn phần thân
    return `${chosenHook}\n\n${baseContent}\n\n${chosenCta}`;
}

/**
 * Kiểm tra kết nối API Key và Prompt mẫu
 */
async function testGemini(apiKey, promptTemplate, model = 'gemini-3.6-flash') {
    if (!apiKey) throw new Error('Vui lòng nhập API Key để kiểm tra.');
    const sampleContent = `Bán gấp căn hộ 2PN 70m2 chung cư Sunrise City, Q7.\nGiá 3.8 tỷ có thương lượng. Full nội thất cao cấp, view Landmark 81 cực đẹp.\nSổ hồng sẵn, công chứng trong ngày. LH: 0912.345.678 (Chính chủ)`;
    let prompt = promptTemplate.replace('{CONTENT}', sampleContent);
    prompt = prompt.replace(/{SENDER}/g, 'Nguyễn Hoàng').replace(/{GROUP}/g, 'Nhóm Căn Hộ Sài Gòn');

    const { text, modelUsed } = await callGeminiApi(apiKey, model, prompt);
    return `[Mô hình sử dụng: ${modelUsed}]\n\n${text}`;
}

module.exports = { rewriteWithGemini, testGemini, spinPostForGroup, isEnglishPost, callGeminiApi, cleanGeminiOutput };
