const { dbAsync } = require('../db');
const { rewriteWithGemini } = require('./gemini');
const { broadcastEvent } = require('./events');

// Bộ đệm gộp tin nhắn (Message Merger) tương tự như trên app Android
const pendingBuffers = new Map(); // key: groupName, value: { timeout, messages: [] }

/**
 * Xử lý tin nhắn đến từ Zalo Web Userscript
 */
async function handleIncomingZaloMessage({ groupName, sender, text, images = [] }) {
    if (!text && (!images || images.length === 0)) return;

    const cleanGroupName = (groupName || 'Zalo Chat').trim();
    const cleanSender = (sender || 'Thành viên').trim();
    const cleanText = (text || '').trim();

    // 1. Kiểm tra xem nhóm này có được theo dõi không
    const monitoredGroups = await dbAsync.all(`SELECT name FROM zalo_groups WHERE is_monitored = 1`);
    if (monitoredGroups.length > 0) {
        const isMatched = monitoredGroups.some(g => 
            g.name.toLowerCase() === cleanGroupName.toLowerCase() ||
            cleanGroupName.toLowerCase().includes(g.name.toLowerCase())
        );
        if (!isMatched) {
            console.log(`[Bỏ qua] Tin nhắn từ nhóm [${cleanGroupName}] vì không nằm trong danh sách theo dõi.`);
            return { status: 'ignored', reason: 'group_not_monitored' };
        }
    }

    // 2. Lưu tin nhắn thô vào bảng messages
    const imgJson = JSON.stringify(images);
    const msgResult = await dbAsync.run(
        `INSERT INTO messages (group_name, sender, content, images) VALUES (?, ?, ?, ?)`,
        [cleanGroupName, cleanSender, cleanText, imgJson]
    );

    await dbAsync.log('info', `Nhận tin từ [${cleanGroupName}] (${cleanSender}): "${cleanText.substring(0, 60)}..."`);
    broadcastEvent('new_zalo_message', {
        id: msgResult.id,
        groupName: cleanGroupName,
        sender: cleanSender,
        content: cleanText,
        images,
        time: new Date().toLocaleTimeString('vi-VN')
    });

    // 3. Cơ chế gộp tin (Buffer) trong 15 giây để gộp các tin nhắn liên tiếp cùng nhóm
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
        await processMergedMessages(cleanGroupName, buffer.messages);
    }, 15000); // 15 giây gom tin

    return { status: 'buffered', messageId: msgResult.id };
}

/**
 * Xử lý chuỗi tin nhắn đã gộp: Gửi qua Gemini AI và đưa vào hàng chờ đăng bài
 */
async function processMergedMessages(groupName, messagesList) {
    if (!messagesList || messagesList.length === 0) return;

    // Ghép nội dung các tin nhắn liên tiếp
    const combinedText = messagesList.map(m => m.text).filter(Boolean).join('\n\n');
    if (!combinedText) return;

    const primarySender = messagesList[0].sender;

    await dbAsync.log('info', `Bắt đầu xử lý ${messagesList.length} tin nhắn đã gộp từ nhóm [${groupName}].`);

    try {
        // Gọi AI Gemini viết lại bài
        const rewritten = await rewriteWithGemini(combinedText, primarySender, groupName);

        // Kiểm tra cài đặt tự động đăng
        const autoPostSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);
        const isAutoPost = autoPostSetting?.value === '1';

        // Lấy danh sách nhóm Facebook đang bật để gắn vào bài
        const activeFbGroups = await dbAsync.all(`SELECT name, url FROM fb_groups WHERE is_active = 1`);
        const targetFbStr = activeFbGroups.map(g => g.name).join(', ') || 'Chưa chọn nhóm';

        const postResult = await dbAsync.run(
            `INSERT INTO posts (group_name, original_text, rewritten_text, target_fb_group, status) VALUES (?, ?, ?, ?, ?)`,
            [groupName, combinedText, rewritten, targetFbStr, isAutoPost ? 'approved' : 'pending']
        );

        broadcastEvent('new_post_ready', {
            id: postResult.id,
            groupName,
            rewrittenText: rewritten,
            status: isAutoPost ? 'approved' : 'pending',
            targetFbGroup: targetFbStr,
            time: new Date().toLocaleTimeString('vi-VN')
        });

        await dbAsync.log('info', `Đã tạo bài viết AI mới (ID: ${postResult.id}) cho nhóm [${groupName}]. Trạng thái: ${isAutoPost ? 'Tự động duyệt' : 'Chờ bạn duyệt'}`);

    } catch (err) {
        await dbAsync.log('error', `Lỗi xử lý tin nhắn nhóm [${groupName}]: ${err.message}`);
    }
}

module.exports = { handleIncomingZaloMessage };
