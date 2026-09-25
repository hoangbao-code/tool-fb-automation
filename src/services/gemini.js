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
 * Tuyệt đối không bọc prompt template hay nạp tin thô khi AI chưa phản hồi.
 */
async function rewriteWithGemini(content, sender = '', groupName = '', overridePrompt = null) {
    if (!content || !content.trim()) {
        throw new Error('Nội dung tin nhắn trống, không thể gửi sang Gemini AI.');
    }

    const rawText = content.trim();

    // Lấy cấu hình URL cuộc trò chuyện đã ghim từ settings
    const targetUrlRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_conversation_url'`);
    const targetUrl = targetUrlRow?.value?.trim() || null;

    let chromeStatus = await isChromeDebuggingActive();

    // Nếu Chrome chưa chạy -> TỰ ĐỘNG KHỞI CHẠY GOOGLE CHROME với cuộc trò chuyện đã ghim!
    if (!chromeStatus.active) {
        console.log('[Gemini Web] Chrome chưa chạy, đang tự động khởi chạy Chrome...');
        await dbAsync.log('info', `[Gemini Web] Đang tự động mở Google Chrome để biên tập tin từ [${groupName || 'Zalo'}]...`);
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
                const apiRes = await callGeminiApi(apiKeyRow.value.trim(), modelRow?.value || 'gemini-3.7-flash', rawText);
                return cleanGeminiOutput(apiRes.text);
            }
            throw new Error(`Không thể khởi chạy Google Chrome: ${launchRes.message}. Vui lòng kiểm tra xem Chrome đã được cài đặt chưa.`);
        }
    }

    let resultTextRaw = '';

    // Gửi thẳng nội dung thô vào Gemini Web (không bọc prompt rườm rà)
    console.log(`[Gemini Web] Đang gửi nội dung thô (${rawText.length} ký tự) vào Gemini Web...`);
    const chromeRes = await sendPromptToChromeGemini(rawText, DEFAULT_PORT, targetUrl);

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

    await dbAsync.log('info', `Gemini Web đã biên tập xong bài viết cho [${groupName || 'Zalo'}] (${resultText.length} ký tự).`);
    return resultText.trim();
}

/**
 * Tạo biến thể bài viết riêng biệt (Unique Spin Content) cho từng nhóm Facebook
 * để tránh thuật toán chống spam trùng lặp của Facebook
 */
function spinPostForGroup(baseContent, targetGroupName = '', index = 0) {
    if (!baseContent) return '';
    
    // Các câu tiêu đề mở đầu biến thể
    const hooks = [
        `📢 CẬP NHẬT MỚI:`,
        `🔥 TIN HOT HÔM NAY:`,
        `✨ DÀNH CHO ANH EM QUAN TÂM:`,
        `💎 SIÊU PHẨM MỚI LÊN SÓNG:`,
        `📌 THÔNG TIN ĐÁNG CHÚ Ý:`,
        `🚀 CHIA SẺ CÙNG CẢ NHÀ:`
    ];

    // Các câu kêu gọi hành động cuối bài
    const ctas = [
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

module.exports = { rewriteWithGemini, testGemini, spinPostForGroup, callGeminiApi, cleanGeminiOutput };
