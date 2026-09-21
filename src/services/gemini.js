const { dbAsync } = require('../db');

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
    const sampleContent = `Bán gấp căn hộ 2PN 70m2 chung cư Sunrise City, Q7.\nGiá 3.8 tỷ có thương lượng. Full nội thất cao cấp, view Landmark 81 cực đẹp.\nSổ hồng sẵn, công chứng trong ngày. LH: 0912.345.678 (Chính chủ)`;
    let prompt = promptTemplate.replace('{CONTENT}', sampleContent);
    prompt = prompt.replace(/{SENDER}/g, 'Nguyễn Hoàng').replace(/{GROUP}/g, 'Nhóm Căn Hộ Sài Gòn');

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
