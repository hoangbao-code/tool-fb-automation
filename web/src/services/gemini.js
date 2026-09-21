const { dbAsync } = require('../db');

/**
 * Gọi Google Gemini API để viết lại nội dung bài đăng
 */
async function rewriteWithGemini(content, sender = '', groupName = '', overridePrompt = null) {
    const keyRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
    const modelRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_model'`);
    const promptRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'ai_prompt_template'`);

    const apiKey = keyRow?.value?.trim();
    if (!apiKey) {
        throw new Error('Chưa cấu hình Gemini API Key. Vui lòng vào Cài đặt để nhập API Key miễn phí từ Google AI Studio.');
    }

    const model = modelRow?.value?.trim() || 'gemini-1.5-flash';
    let template = overridePrompt || promptRow?.value || 'Hãy viết lại bài đăng sau để đăng lên Facebook:\n{CONTENT}';

    let finalPrompt = template;
    if (finalPrompt.includes('{CONTENT}')) {
        finalPrompt = finalPrompt.replace('{CONTENT}', content.trim());
    } else {
        finalPrompt = `${finalPrompt}\n\nNội dung cần viết lại:\n${content.trim()}`;
    }
    finalPrompt = finalPrompt.replace(/{SENDER}/g, sender || 'Thành viên');
    finalPrompt = finalPrompt.replace(/{GROUP}/g, groupName || 'Nhóm Zalo');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: finalPrompt }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048
            }
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Lỗi từ Gemini API (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
        throw new Error('Gemini không trả về nội dung hợp lệ.');
    }

    await dbAsync.log('info', `AI Gemini (${model}) đã viết lại bài cho nhóm [${groupName}] thành công.`);
    return resultText.trim();
}

/**
 * Kiểm tra kết nối API Key và Prompt mẫu
 */
async function testGemini(apiKey, promptTemplate, model = 'gemini-1.5-flash') {
    if (!apiKey) throw new Error('Vui lòng nhập API Key để kiểm tra.');
    const sampleContent = `Cho thuê phòng trọ cao cấp full NT tại 123 XVNT, Bình Thạnh.\nGiá 5tr5/tháng, cọc 1 tháng. Giờ giấc tự do, có máy giặt, ban công.\nLH: 0901234567 gặp chủ nhà.`;
    let prompt = promptTemplate.replace('{CONTENT}', sampleContent);
    prompt = prompt.replace(/{SENDER}/g, 'Nguyễn Văn A').replace(/{GROUP}/g, 'Nhóm Phòng Trọ Sài Gòn');

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Lỗi kết nối Gemini (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Không có kết quả trả về.';
}

module.exports = { rewriteWithGemini, testGemini };
