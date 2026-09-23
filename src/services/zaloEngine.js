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

    // 1. Kiểm tra nhóm theo dõi (Chỉ lấy từ các group được bạn chỉ định)
    const monitoredGroups = await dbAsync.all(`SELECT name FROM zalo_groups WHERE is_monitored = 1`);
    if (monitoredGroups.length === 0) {
        // Chưa chọn theo dõi nhóm Zalo nào -> Bỏ qua tin nhắn
        return;
    }
    const isMatched = monitoredGroups.some(g => 
        g.name.toLowerCase() === cleanGroupName.toLowerCase() ||
        cleanGroupName.toLowerCase().includes(g.name.toLowerCase()) ||
        g.name.toLowerCase().includes(cleanGroupName.toLowerCase())
    );
    if (!isMatched) {
        // Không thuộc danh sách nhóm Zalo được theo dõi -> Bỏ qua
        return;
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
    const messageItem = { id: msgResult.id, sender: cleanSender, text: cleanText, images: images || [] };
    if (pendingBuffers.has(cleanGroupName)) {
        clearTimeout(pendingBuffers.get(cleanGroupName).timeout);
        pendingBuffers.get(cleanGroupName).messages.push(messageItem);
    } else {
        pendingBuffers.set(cleanGroupName, {
            messages: [messageItem]
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
    const primaryMsgId = messagesList[0].id || null;

    // Gom toàn bộ ảnh từ các tin nhắn trong cụm
    const allImages = [];
    messagesList.forEach(m => {
        if (Array.isArray(m.images)) {
            m.images.forEach(img => {
                if (img && !allImages.includes(img)) allImages.push(img);
            });
        }
    });

    if (primaryMsgId && allImages.length > 0) {
        try {
            await dbAsync.run(
                `UPDATE messages SET images = ? WHERE id = ?`,
                [JSON.stringify(allImages), primaryMsgId]
            );
        } catch (e) {
            console.warn('[ZaloEngine] Lỗi cập nhật images cho message:', e.message);
        }
    }

    await dbAsync.log('info', `Đang gộp ${messagesList.length} tin (${allImages.length} ảnh) từ [${groupName}] và gửi sang AI Gemini biên tập...`);

    // Lấy danh sách nhóm Facebook đang bật & cài đặt tự động duyệt
    let targetFbStr = 'Tất cả nhóm đã chọn';
    let isAuto = false;
    try {
        const autoSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);
        isAuto = autoSetting?.value === '1';

        const activeFbGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);
        targetFbStr = activeFbGroups.map(g => g.name).join(', ') || 'Tất cả nhóm đã chọn';
    } catch (e) {
        console.warn('[ZaloEngine] Lỗi lấy settings/fb_groups:', e.message);
    }

    try {
        const rewritten = await rewriteWithGemini(combinedText, primarySender, groupName);

        const postResult = await dbAsync.run(
            `INSERT INTO posts (message_id, group_name, original_text, rewritten_text, target_fb_group, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [primaryMsgId, groupName, combinedText, rewritten, targetFbStr, isAuto ? 'approved' : 'pending']
        );

        if (eventBroadcaster) {
            eventBroadcaster('new-post-ready', {
                id: postResult.id,
                messageId: primaryMsgId,
                groupName,
                originalText: combinedText,
                rewrittenText: rewritten,
                images: allImages,
                status: isAuto ? 'approved' : 'pending',
                targetFbGroup: targetFbStr,
                time: new Date().toLocaleTimeString('vi-VN')
            });
        }

        await dbAsync.log('info', `Đã tạo bài viết AI mới (#${postResult.id}) cho nhóm [${groupName}] (${allImages.length} ảnh). Trạng thái: ${isAuto ? 'Tự động duyệt (Chờ đăng)' : 'Chờ bạn duyệt'}`);

    } catch (err) {
        await dbAsync.log('error', `Lỗi AI biên tập bài nhóm [${groupName}]: ${err.message}`);
        // Lưu bài dự phòng vào hàng chờ duyệt để bảo toàn nội dung và hình ảnh
        try {
            const fallbackPost = await dbAsync.run(
                `INSERT INTO posts (message_id, group_name, original_text, rewritten_text, target_fb_group, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [primaryMsgId, groupName, combinedText, combinedText, targetFbStr, 'pending']
            );
            await dbAsync.log('warn', `Đã lưu bài gốc (#${fallbackPost.id}) kèm ${allImages.length} ảnh vào hàng chờ duyệt (bạn có thể bấm Viết lại AI).`);
        } catch (innerErr) {
            console.error('[ZaloEngine] Lỗi lưu fallback post:', innerErr.message);
        }
    }
}

module.exports = { processZaloMessage, setEventBroadcaster };
