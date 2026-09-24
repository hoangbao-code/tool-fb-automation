const { dbAsync } = require('../db');
const { spinPostForGroup } = require('./gemini');

let fbWebviewRef = null;
let eventBroadcaster = null;
let isWorkerStarted = false;

function setFbWebview(wv) {
    fbWebviewRef = wv;
}

function setFbEventBroadcaster(fn) {
    eventBroadcaster = fn;
}

/**
 * Kiểm tra xem thời điểm hiện tại có nằm trong Khung Giờ Vàng hay không
 */
function isWithinGoldenHours(slotsJson, testDate = null) {
    if (!slotsJson) return true;
    try {
        const slots = typeof slotsJson === 'string' ? JSON.parse(slotsJson) : slotsJson;
        if (!Array.isArray(slots) || slots.length === 0) return true;

        const now = testDate || new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        return slots.some(slot => {
            if (!slot.start || !slot.end) return false;
            const [sh, sm] = slot.start.split(':').map(Number);
            const [eh, em] = slot.end.split(':').map(Number);
            const startMin = sh * 60 + (sm || 0);
            const endMin = eh * 60 + (em || 0);
            return currentMinutes >= startMin && currentMinutes <= endMin;
        });
    } catch (e) {
        return true;
    }
}

/**
 * Xử lý danh sách nhóm Facebook vừa quét được từ Webview
 */
async function handleScannedGroups(groupsList) {
    if (!Array.isArray(groupsList) || groupsList.length === 0) return;

    let addedCount = 0;
    for (const g of groupsList) {
        if (!g.url || !g.name) continue;
        const cleanName = g.name.trim();
        const cleanUrl = g.url.trim();
        const memberCount = g.memberCount || '';

        const res = await dbAsync.run(
            `INSERT INTO fb_groups (name, url, member_count, is_active) VALUES (?, ?, ?, 1)
             ON CONFLICT(url) DO UPDATE SET name = ?, member_count = ?`,
            [cleanName, cleanUrl, memberCount, cleanName, memberCount]
        );
        if (res.changes > 0) addedCount++;
    }

    await dbAsync.log('info', `Facebook Webview đã tự động quét được ${groupsList.length} nhóm (Lưu mới/Cập nhật: ${addedCount}).`);
    if (eventBroadcaster) {
        eventBroadcaster('fb-groups-updated', { count: groupsList.length });
    }
}

/**
 * Xáo trộn ngẫu nhiên danh sách (Fisher-Yates Shuffle)
 * Đảm bảo mỗi lần đăng có thứ tự các nhóm lộn xộn hoàn toàn khác nhau
 */
function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Xuất bản bài viết lên các nhóm Facebook đã kích hoạt
 * - Tự động xáo trộn thứ tự nhóm (lộn xộn) để tránh thuật toán bot Facebook
 * - Đăng rải rác từng nhóm một với khoảng nghỉ ngẫu nhiên (Jitter) để chống spam và tránh bị ngâm bài
 */
async function publishPost(postId, clusterId = null) {
    const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postId]);
    if (!post) throw new Error('Không tìm thấy bài viết ID: ' + postId);

    const actualClusterId = clusterId || post.target_cluster_id;
    let targetGroups = [];
    let clusterLabel = '';

    if (actualClusterId && actualClusterId !== 'all') {
        const cluster = await dbAsync.get(`SELECT name FROM fb_clusters WHERE id = ?`, [actualClusterId]);
        clusterLabel = cluster ? `Cụm [${cluster.name}]` : `Cụm #${actualClusterId}`;
        targetGroups = await dbAsync.getGroupsForCluster(actualClusterId);
    } else {
        clusterLabel = 'Tất cả nhóm đã chọn';
        targetGroups = await dbAsync.all(`SELECT * FROM fb_groups WHERE is_active = 1`);
    }

    if (targetGroups.length === 0) {
        throw new Error(`Không tìm thấy nhóm Facebook nào khả dụng trong ${clusterLabel}. Hãy kiểm tra lại nhóm đã bật.`);
    }

    // 1. XÁO TRỘN LỘN XỘN NGẪU NHIÊN THỨ TỰ CÁC NHÓM (Fisher-Yates Shuffle)
    const shuffledGroups = shuffleArray(targetGroups);

    const spinRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'ai_spin_enabled'`);
    const isSpinEnabled = (spinRow?.value !== '0');

    const baseText = post.rewritten_text || post.original_text;

    await dbAsync.run(`UPDATE posts SET status = 'publishing', target_fb_group = ? WHERE id = ?`, [clusterLabel, postId]);
    await dbAsync.log('info', `[Facebook] Bắt đầu đăng bài #${postId} rải rác lộn xộn vào ${shuffledGroups.length} nhóm (${clusterLabel} - Xáo trộn ngẫu nhiên & Spin content: ${isSpinEnabled ? 'BẬT' : 'TẮT'})...`);

    // Gửi payload ban đầu vào FB Webview nếu có
    if (fbWebviewRef) {
        try {
            const payloadGroups = shuffledGroups.map((group, idx) => ({
                id: group.id,
                name: group.name,
                url: group.url,
                content: isSpinEnabled ? spinPostForGroup(baseText, group.name, idx) : baseText
            }));

            fbWebviewRef.send('publish-to-fb', {
                postId: post.id,
                content: baseText,
                groups: payloadGroups
            });
        } catch (e) {
            console.error('Lỗi gửi lệnh sang FB Webview:', e);
        }
    }

    // 2. TIẾN HÀNH ĐĂNG RẢI RÁC LẦN LƯỢT VÀO TỪNG NHÓM VỚI KHOẢNG NGHỈ NGẪU NHIÊN (JITTER DELAY)
    // Tránh việc cùng 1 lúc bắn dồn dập vào nhiều nhóm gây spam và bị admin ngâm bài
    const delayMinRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'delay_min_seconds'`);
    const delayMaxRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'delay_max_seconds'`);
    const baseMin = Math.max(15, parseInt(delayMinRow?.value || '45', 10));
    const baseMax = Math.max(baseMin, parseInt(delayMaxRow?.value || '90', 10));

    for (let i = 0; i < shuffledGroups.length; i++) {
        // Kiểm tra Dừng Khẩn Cấp
        const stopRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'emergency_stop'`);
        if (stopRow?.value === '1') {
            await dbAsync.log('warn', `[Facebook] Đã dừng khẩn cấp quá trình đăng bài #${postId} tại nhóm ${i + 1}/${shuffledGroups.length}.`);
            await dbAsync.run(`UPDATE posts SET status = 'pending' WHERE id = ?`, [postId]);
            return { stopped: true };
        }

        const group = shuffledGroups[i];
        const groupContent = isSpinEnabled ? spinPostForGroup(baseText, group.name, i) : baseText;

        await dbAsync.log('info', `[Facebook] Đang đăng rải rác (#${i + 1}/${shuffledGroups.length}): Nhóm [${group.name}] (Thứ tự xáo trộn ngẫu nhiên)...`);

        if (eventBroadcaster) {
            eventBroadcaster('fb-publish-step', {
                postId: post.id,
                groupName: group.name,
                groupUrl: group.url,
                content: groupContent,
                step: i + 1,
                total: shuffledGroups.length
            });
        }

        // Nghỉ giãn cách rải rác giữa các nhóm (trừ nhóm cuối cùng)
        if (i < shuffledGroups.length - 1) {
            const jitterDelay = Math.floor(Math.random() * (baseMax - baseMin + 1)) + baseMin;
            await dbAsync.log('info', `[Facebook] Giãn cách ngẫu nhiên ${jitterDelay}s trước khi đăng nhóm tiếp theo để chống spam & ngâm bài...`);
            await new Promise(r => setTimeout(r, jitterDelay * 1000));
        }
    }

    await dbAsync.run(
        `UPDATE posts SET status = 'posted', posted_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [postId]
    );

    if (eventBroadcaster) {
        eventBroadcaster('post-published', { id: postId, status: 'posted', groupCount: shuffledGroups.length });
    }
    await dbAsync.log('info', `✓ Đã hoàn tất đăng bài #${postId} rải rác lộn xộn lên ${shuffledGroups.length} nhóm an toàn!`);
    return { success: true };
}

/**
 * Worker tự động đăng bài theo chu kỳ giãn cách ngẫu nhiên & Khung Giờ Vàng
 */
function startFbPostWorker() {
    if (isWorkerStarted) return;
    isWorkerStarted = true;

    setInterval(async () => {
        try {
            const autoSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);
            const stopSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'emergency_stop'`);

            if (autoSetting?.value !== '1' || stopSetting?.value === '1') return;

            // Kiểm tra Lên lịch Khung Giờ Vàng (Smart Scheduler)
            const schedulerRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'smart_scheduler_enabled'`);
            if (schedulerRow?.value === '1') {
                const slotsRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'smart_scheduler_slots'`);
                if (!isWithinGoldenHours(slotsRow?.value)) {
                    // Ngoài khung giờ vàng -> Tạm hoãn đợi khung giờ tiếp theo
                    return;
                }
            }

            // Tìm bài viết ở trạng thái 'approved'
            const pendingPost = await dbAsync.get(`SELECT * FROM posts WHERE status = 'approved' ORDER BY id ASC LIMIT 1`);
            if (!pendingPost) return;

            // Đánh dấu ngay sang 'publishing' để vòng lặp 30s sau không chọn trùng
            await dbAsync.run(`UPDATE posts SET status = 'publishing' WHERE id = ?`, [pendingPost.id]);

            // Tính thời gian giãn cách ngẫu nhiên (chống spam / checkpoint Facebook)
            const minRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'delay_min_seconds'`);
            const maxRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'delay_max_seconds'`);
            const minSec = parseInt(minRow?.value || '180', 10);
            const maxSec = parseInt(maxRow?.value || '480', 10);
            const delaySec = Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;

            await dbAsync.log('info', `Hàng đợi tự động: Bài #${pendingPost.id} sẽ được đăng sau ${delaySec} giây (giãn cách ngẫu nhiên chống checkpoint).`);

            setTimeout(async () => {
                try {
                    await publishPost(pendingPost.id);
                } catch (e) {
                    console.error('Lỗi worker publish:', e);
                    await dbAsync.run(`UPDATE posts SET status = 'failed', error_message = ? WHERE id = ?`, [e.message, pendingPost.id]);
                }
            }, delaySec * 1000);

        } catch (err) {
            console.error('Lỗi worker loop:', err);
        }
    }, 30000);
}

module.exports = {
    setFbWebview,
    setFbEventBroadcaster,
    handleScannedGroups,
    publishPost,
    startFbPostWorker,
    isWithinGoldenHours
};
