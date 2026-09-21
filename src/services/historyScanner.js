const { dbAsync } = require('../db');
const { rewriteWithGemini } = require('./gemini');

/**
 * Kiểm tra xem tin nhắn có phải bài đăng giá trị hay không (lọc bỏ tin chat ngắn, rác)
 */
function isValidHistoricalPost(content) {
    if (!content || typeof content !== 'string') return false;
    const clean = content.trim();
    if (clean.length < 25) return false;

    // Các từ ngữ hội thoại ngắn hoặc tin rác thông thường
    const spamPatterns = [
        /^(ok|oke|okie|dạ|da|vang|vâng|alo|chấm|inbox|\.|\?)$/i,
        /^(chào|hello|hi|xin chào|good morning)/i,
        /^(đã gửi một|đã tham gia|đã rời khỏi|đã đổi ảnh)/i
    ];

    for (const pat of spamPatterns) {
        if (pat.test(clean)) return false;
    }

    // Ưu tiên tin có chứa các dấu hiệu bài đăng (giá, liên hệ, diện tích, thông tin...)
    const hasPostKeywords = /(bán|cho thuê|cần|tuyển|giá|lh|liên hệ|sđt|dt|phone|tỷ|triệu|m2|phòng|nhà|căn hộ|khu vực|tphcm|hà nội|\d{9,11})/i.test(clean);
    
    // Nếu dài trên 50 ký tự hoặc có từ khóa bài đăng thì xem là hợp lệ
    return clean.length >= 50 || (clean.length >= 25 && hasPostKeywords);
}

/**
 * Xử lý danh sách tin nhắn lịch sử và nạp vào hàng đợi đăng dần lên Facebook
 */
async function processHistoricalZaloMessages(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return { success: true, total: 0, queued: 0, skipped: 0 };
    }

    const maxPostsToQueue = options.limit || 50; // Giới hạn tối đa cho 1 đợt quét
    const monitoredGroups = await dbAsync.all(`SELECT name FROM zalo_groups WHERE is_monitored = 1`);
    const monitoredNames = new Set(monitoredGroups.map(g => g.name.toLowerCase().trim()));

    // Kiểm tra cài đặt tự động đăng bài
    const autoSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);
    const isAuto = autoSetting?.value === '1';

    // Lấy danh sách nhóm Facebook đang bật
    const activeFbGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);
    const targetFbStr = activeFbGroups.map(g => g.name).join(', ') || 'Tất cả nhóm đã chọn';

    let queuedCount = 0;
    let skippedCount = 0;

    for (const msg of messages) {
        if (queuedCount >= maxPostsToQueue) break;

        let groupName = (msg.groupName || options.activeGroupName || 'Nhóm Zalo').trim();
        const text = (msg.text || msg.content || '').trim();
        const sender = (msg.sender || 'Thành viên').trim();

        // 1. Kiểm tra nhóm có thuộc diện theo dõi không
        if (monitoredNames.size > 0 && !options.ignoreGroupFilter) {
            const isMatch = monitoredNames.has(groupName.toLowerCase()) || 
                            (options.activeGroupName && monitoredNames.has(options.activeGroupName.toLowerCase()));
            if (!isMatch) {
                skippedCount++;
                continue;
            }
            if (!monitoredNames.has(groupName.toLowerCase()) && options.activeGroupName) {
                groupName = options.activeGroupName;
            }
        }

        // 2. Kiểm tra chất lượng nội dung
        if (!isValidHistoricalPost(text)) {
            skippedCount++;
            continue;
        }

        // 3. Khử trùng lặp nội dung (tránh nạp lại bài đã từng đăng hoặc đã có trong hàng đợi)
        const duplicateInPosts = await dbAsync.get(
            `SELECT id FROM posts WHERE original_text = ? LIMIT 1`,
            [text]
        );
        if (duplicateInPosts) {
            skippedCount++;
            continue;
        }

        // 4. Lưu vào bảng messages
        const msgResult = await dbAsync.run(
            `INSERT INTO messages (group_name, sender, content, images) VALUES (?, ?, ?, ?)`,
            [groupName, sender, text, JSON.stringify(msg.images || [])]
        );

        // 5. Gửi sang AI Gemini để biên tập lại thành bài đăng Facebook
        try {
            let rewritten = '';
            try {
                rewritten = await rewriteWithGemini(text, sender, groupName);
            } catch (aiErr) {
                console.warn(`[HistoryScanner] Lỗi gọi Gemini: ${aiErr.message}. Sử dụng nội dung gốc.`);
                rewritten = text;
            }

            // 6. Nạp vào hàng đợi bài viết (posts)
            // Trạng thái: 'approved' (để worker tự động đăng dần) hoặc 'pending' (chờ duyệt tay)
            const initialStatus = isAuto ? 'approved' : 'pending';
            await dbAsync.run(
                `INSERT INTO posts (message_id, group_name, original_text, rewritten_text, target_fb_group, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [msgResult.id, groupName, text, rewritten, targetFbStr, initialStatus]
            );

            queuedCount++;
            await dbAsync.log('info', `[Quét Lịch Sử] Đã nạp bài viết từ [${groupName}] vào hàng đợi (#${queuedCount}) - Trạng thái: ${initialStatus}`);
        } catch (postErr) {
            console.error(`[HistoryScanner] Lỗi lưu bài viết:`, postErr);
            skippedCount++;
        }
    }

    await dbAsync.log('info', `Hoàn tất quét lịch sử tin nhắn: Đã nạp ${queuedCount} bài vào hàng đợi để đăng dần (Bỏ qua: ${skippedCount}).`);
    return {
        success: true,
        total: messages.length,
        queued: queuedCount,
        skipped: skippedCount
    };
}

module.exports = {
    isValidHistoricalPost,
    processHistoricalZaloMessages
};
