const { dbAsync } = require('../db');
const { rewriteWithGemini } = require('./gemini');

const pendingBuffers = new Map();
let eventBroadcaster = null;

function setEventBroadcaster(fn) {
    eventBroadcaster = fn;
}

/**
 * Xử lý tin nhắn nhận được trực tiếp từ Zalo Webview bên trong ứng dụng
 */
async function processZaloMessage({ groupName, sender, text, images = [] }) {
    if (!text && (!images || images.length === 0)) return;

    const cleanGroupName = (groupName || 'Zalo Chat').trim();
    const cleanSender = (sender || 'Thành viên').trim();
    const cleanText = (text || '').trim();

    // 1. Kiểm tra nhóm theo dõi
    const monitoredGroups = await dbAsync.all(`SELECT name FROM zalo_groups WHERE is_monitored = 1`);
    if (monitoredGroups.length > 0) {
        const isMatched = monitoredGroups.some(g => 
            g.name.toLowerCase() === cleanGroupName.toLowerCase() ||
            cleanGroupName.toLowerCase().includes(g.name.toLowerCase())
        );
        if (!isMatched) {
            console.log(`[Bỏ qua] Tin từ nhóm [${cleanGroupName}] vì chưa chọn theo dõi.`);
            return;
        }
    }

    // 2. Lưu tin nhắn thô vào SQLite
    const imgJson = JSON.stringify(images);
    const msgResult = await dbAsync.run(
        `INSERT INTO messages (group_name, sender, content, images) VALUES (?, ?, ?, ?)`,
        [cleanGroupName, cleanSender, cleanText, imgJson]
    );

    await dbAsync.log('info', `[Zalo Web] Bắt được tin từ [${cleanGroupName}] (${cleanSender}): "${cleanText.substring(0, 60)}..."`);
    
    if (eventBroadcaster) {
        eventBroadcaster('new-zalo-message', {
            id: msgResult.id,
            groupName: cleanGroupName,
            sender: cleanSender,
            content: cleanText,
            images,
            time: new Date().toLocaleTimeString('vi-VN')
        });
    }

    // 3. Gom tin (Buffer) 15 giây để gộp các câu chat rời rạc
    if (pendingBuffers.has(cleanGroupName)) {
        clearTimeout(pendingBuffers.get(cleanGroupName).timeout);
        pendingBuffers.get(cleanGroupName).messages.push({ sender: cleanSender, text: cleanText, images });
    } else {
        pendingBuffers.set(cleanGroupName, {
            messages: [{ sender: cleanSender, text: cleanText, images }]
        });
    }

    const buffer = pendingBuffers.get(cleanGroupName);
    buffer.timeout = setTimeout(async () => {
        pendingBuffers.delete(cleanGroupName);
        await processMergedZaloMessages(cleanGroupName, buffer.messages);
    }, 15000);
}

/**
 * Gộp và gửi sang Gemini AI để viết lại bài
 */
async function processMergedZaloMessages(groupName, messagesList) {
    if (!messagesList || messagesList.length === 0) return;

    const combinedText = messagesList.map(m => m.text).filter(Boolean).join('\n\n');
    if (!combinedText) return;

    const primarySender = messagesList[0].sender;
    await dbAsync.log('info', `Đang gộp ${messagesList.length} tin từ [${groupName}] và gửi sang AI Gemini biên tập...`);

    try {
        const rewritten = await rewriteWithGemini(combinedText, primarySender, groupName);

        // Kiểm tra cài đặt tự động đăng bài
        const autoSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);
        const isAuto = autoSetting?.value === '1';

        // Lấy danh sách nhóm Facebook đang bật
        const activeFbGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);
        const targetFbStr = activeFbGroups.map(g => g.name).join(', ') || 'Tất cả nhóm đã chọn';

        const postResult = await dbAsync.run(
            `INSERT INTO posts (group_name, original_text, rewritten_text, target_fb_group, status) VALUES (?, ?, ?, ?, ?)`,
            [groupName, combinedText, rewritten, targetFbStr, isAuto ? 'approved' : 'pending']
        );

        if (eventBroadcaster) {
            eventBroadcaster('new-post-ready', {
                id: postResult.id,
                groupName,
                originalText: combinedText,
                rewrittenText: rewritten,
                status: isAuto ? 'approved' : 'pending',
                targetFbGroup: targetFbStr,
                time: new Date().toLocaleTimeString('vi-VN')
            });
        }

        await dbAsync.log('info', `Đã tạo bài viết AI mới (#${postResult.id}) cho nhóm [${groupName}]. Trạng thái: ${isAuto ? 'Tự động duyệt (Chờ đăng)' : 'Chờ bạn duyệt'}`);

    } catch (err) {
        await dbAsync.log('error', `Lỗi AI biên tập bài nhóm [${groupName}]: ${err.message}`);
    }
}

module.exports = { processZaloMessage, setEventBroadcaster };
