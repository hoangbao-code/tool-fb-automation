const { dbAsync } = require('../db');
const { rewriteWithGemini } = require('./gemini');

/**
 * Chuẩn hóa tên nhóm: Xóa bỏ khoảng trắng non-breaking (\u00A0), bỏ đếm số thành viên (vd: "(150 thành viên)")
 */
function normalizeName(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/[\u00A0\s]+/g, ' ')
        .replace(/\s*\(\d+.*?\)$/, '')
        .trim()
        .toLowerCase();
}

/**
 * Kiểm tra xem tin nhắn có phải bài đăng giá trị hay không (lọc bỏ tin chat ngắn, rác)
 */
function isValidHistoricalPost(content) {
    if (!content || typeof content !== 'string') return false;
    const clean = content.trim();
    if (clean.length < 20) return false;

    // Các từ ngữ hội thoại ngắn hoặc tin rác thông thường
    const spamPatterns = [
        /^(ok|oke|okie|dạ|da|vang|vâng|alo|chấm|inbox|\.|\?)$/i,
        /^(chào|hello|hi|xin chào|good morning)/i,
        /^(đã gửi một|đã tham gia|đã rời khỏi|đã đổi ảnh|đã ghim)/i
    ];

    for (const pat of spamPatterns) {
        if (pat.test(clean)) return false;
    }

    // Nhận diện bài đăng bán hàng, bất động sản, CHDV, phòng trọ, tuyển dụng
    const hasPostKeywords = /(bán|cho thuê|cần|tuyển|giá|lh|liên hệ|sđt|dt|phone|tỷ|triệu|tr\/|m2|phòng|nhà|căn hộ|chdv|studio|trống|nội thất|ban công|cọc|pass|ở ghép|homestay|chung cư|khu vực|tphcm|hà nội|q\d+|\d{9,11})/i.test(clean);
    
    // Nếu dài trên 40 ký tự hoặc có từ khóa bài đăng (>= 20 ký tự) thì xem là hợp lệ
    return clean.length >= 40 || (clean.length >= 20 && hasPostKeywords);
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
    
    // Danh sách tên nhóm chuẩn hóa
    const monitoredList = monitoredGroups.map(g => ({
        raw: g.name,
        normalized: normalizeName(g.name)
    })).filter(g => g.normalized.length > 0);

    const monitoredSet = new Set(monitoredList.map(g => g.normalized));

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

        let rawGroupName = (msg.groupName || options.activeGroupName || 'Nhóm Zalo').trim();
        const text = (msg.text || msg.content || '').trim();
        const sender = (msg.sender || 'Thành viên').trim();

        // 1. Kiểm tra nhóm có thuộc diện theo dõi không
        if (!options.ignoreGroupFilter && monitoredSet.size > 0) {
            const cleanTarget = normalizeName(rawGroupName);
            const cleanActive = normalizeName(options.activeGroupName);

            let matchedCanonicalName = '';

            // So khớp trực tiếp hoặc tương đối
            if (cleanTarget && monitoredSet.has(cleanTarget)) {
                matchedCanonicalName = rawGroupName;
            } else if (cleanActive && monitoredSet.has(cleanActive)) {
                matchedCanonicalName = options.activeGroupName;
            } else {
                for (const item of monitoredList) {
                    if ((cleanTarget && (cleanTarget.includes(item.normalized) || item.normalized.includes(cleanTarget))) ||
                        (cleanActive && (cleanActive.includes(item.normalized) || item.normalized.includes(cleanActive)))) {
                        matchedCanonicalName = item.raw;
                        break;
                    }
                }
            }

            // Nếu không tìm thấy nhóm nào khớp và không phải tên chung
            if (!matchedCanonicalName) {
                if (cleanTarget === 'nhóm zalo đang mở' || cleanTarget === 'nhóm zalo') {
                    matchedCanonicalName = options.activeGroupName || monitoredList[0]?.raw || rawGroupName;
                } else {
                    skippedCount++;
                    continue;
                }
            } else {
                rawGroupName = matchedCanonicalName;
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
            [rawGroupName, sender, text, JSON.stringify(msg.images || [])]
        );

        // 5. Gửi sang AI Gemini để biên tập lại thành bài đăng Facebook
        try {
            let rewritten = '';
            try {
                rewritten = await rewriteWithGemini(text, sender, rawGroupName);
            } catch (aiErr) {
                console.warn(`[HistoryScanner] Lỗi gọi Gemini: ${aiErr.message}. Sử dụng nội dung gốc.`);
                rewritten = text;
            }

            // 6. Nạp vào hàng đợi bài viết (posts)
            // Trạng thái: 'approved' (để worker tự động đăng dần) hoặc 'pending' (chờ duyệt tay)
            const initialStatus = isAuto ? 'approved' : 'pending';
            await dbAsync.run(
                `INSERT INTO posts (message_id, group_name, original_text, rewritten_text, target_fb_group, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [msgResult.id, rawGroupName, text, rewritten, targetFbStr, initialStatus]
            );

            queuedCount++;
            if (rewritten === text) {
                await dbAsync.log('warn', `[Quét Lịch Sử] Bài viết #${queuedCount} giữ nguyên nội dung gốc (AI chưa kịp biên tập). Bạn có thể bấm "Viết lại AI" trên Bảng tin.`);
            } else {
                await dbAsync.log('info', `[Quét Lịch Sử] Đã nạp bài viết từ [${rawGroupName}] vào hàng đợi (#${queuedCount}) - Trạng thái: ${initialStatus}`);
            }

            // Nghỉ 1.5 giây giữa các tin để Chrome Gemini kịp chuyển đổi mượt mà
            await new Promise(r => setTimeout(r, 1500));
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
    normalizeName,
    isValidHistoricalPost,
    processHistoricalZaloMessages
};
