const { dbAsync } = require('../db');

/**
 * Gọi Google Gemini API với cơ chế tự động chuyển đổi mô hình dự phòng (Auto-Fallback)
 * nếu mô hình cũ bị Google khai tử (như gemini-2.0-flash -> gemini-3.6-flash).
 */
async function callGeminiApi(apiKey, requestedModel, prompt) {
    let cleanModel = requestedModel?.trim() || 'gemini-1.5-flash';
    if (cleanModel === 'gemini-2.0-flash') {
        cleanModel = 'gemini-1.5-flash';
    }

    // Danh sách các mô hình theo thứ tự ưu tiên (ưu tiên mô hình ổn định, dung lượng lớn nhất)
    const modelsToTry = [cleanModel];
    const candidateList = ['gemini-1.5-flash', 'gemini-3.6-flash', 'gemini-1.5-pro', 'gemini-2.5-flash'];
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
                signal: AbortSignal.timeout(12000),
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
            
            // Nếu model trả về 503 (quá tải/high demand), 429 (rate limit), 404 (khai tử), hoặc lỗi server (5xx)
            // -> Tự động chuyển sang model dự phòng kế tiếp ngay lập tức
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
                await new Promise(r => setTimeout(r, 500));
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
                await new Promise(r => setTimeout(r, 500));
                continue;
            }
            throw err;
        }
    }
    throw lastError;
}

/**
 * Gọi Google Gemini API viết lại nội dung bài đăng
 */
async function rewriteWithGemini(content, sender = '', groupName = '', overridePrompt = null) {
    const keyRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
    const modelRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_model'`);
    const promptRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'ai_prompt_template'`);

    const apiKey = keyRow?.value?.trim();
    if (!apiKey) {
        throw new Error('Chưa cấu hình Gemini API Key. Vui lòng vào tab AI Gemini để nhập API Key miễn phí.');
    }

    const model = modelRow?.value?.trim() || 'gemini-3.6-flash';
    let template = overridePrompt || promptRow?.value || 'Hãy viết lại bài đăng sau để đăng lên Facebook:\n{CONTENT}';

    let finalPrompt = template;
    if (finalPrompt.includes('{CONTENT}')) {
        finalPrompt = finalPrompt.replace('{CONTENT}', content.trim());
    } else {
        finalPrompt = `${finalPrompt}\n\nNội dung cần viết lại:\n${content.trim()}`;
    }
    finalPrompt = finalPrompt.replace(/{SENDER}/g, sender || 'Thành viên');
    finalPrompt = finalPrompt.replace(/{GROUP}/g, groupName || 'Nhóm Zalo');

    const { text: resultTextRaw, modelUsed } = await callGeminiApi(apiKey, model, finalPrompt);
    let resultText = resultTextRaw;

    // 1. Tự động chèn thông tin liên hệ (chữ ký) nếu có
    const sigRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'custom_signature'`);
    if (sigRow?.value && sigRow.value.trim()) {
        resultText += `\n\n${sigRow.value.trim()}`;
    }

    // 2. Tự động chèn dàn Hashtags cá nhân nếu có
    const tagRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'custom_hashtags'`);
    if (tagRow?.value && tagRow.value.trim()) {
        resultText += `\n\n${tagRow.value.trim()}`;
    }

    await dbAsync.log('info', `AI Gemini (${modelUsed}) đã viết lại bài cho nhóm [${groupName}] thành công (đã chèn chữ ký & hashtags).`);
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

module.exports = { rewriteWithGemini, testGemini, spinPostForGroup };
