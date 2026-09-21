const { dbAsync } = require('../db');

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
 * Xuất bản bài viết lên các nhóm Facebook đã kích hoạt
 */
async function publishPost(postId) {
    const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postId]);
    if (!post) throw new Error('Không tìm thấy bài viết ID: ' + postId);

    const activeFbGroups = await dbAsync.all(`SELECT * FROM fb_groups WHERE is_active = 1`);
    if (activeFbGroups.length === 0) {
        throw new Error('Chưa có nhóm Facebook nào được chọn. Hãy vào tab Nhóm FB để tích chọn ít nhất 1 nhóm.');
    }

    await dbAsync.log('info', `Bắt đầu xuất bản bài viết #${postId} lên ${activeFbGroups.length} nhóm Facebook...`);

    // Gửi lệnh đăng bài trực tiếp vào Facebook Webview thông qua preload script
    if (fbWebviewRef) {
        try {
            fbWebviewRef.send('publish-to-fb', {
                postId: post.id,
                content: post.rewritten_text || post.original_text,
                groups: activeFbGroups
            });
        } catch (e) {
            console.error('Lỗi gửi lệnh sang FB Webview:', e);
        }
    }

    await dbAsync.run(
        `UPDATE posts SET status = 'posted', posted_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [postId]
    );

    if (eventBroadcaster) {
        eventBroadcaster('post-published', { id: postId, status: 'posted' });
    }
    await dbAsync.log('info', `Đã xuất bản thành công bài đăng #${postId}.`);
    return { success: true };
}

/**
 * Worker tự động đăng bài theo chu kỳ giãn cách ngẫu nhiên (Jitter Delay)
 */
function startFbPostWorker() {
    if (isWorkerStarted) return;
    isWorkerStarted = true;

    setInterval(async () => {
        try {
            const autoSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);
            const stopSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'emergency_stop'`);

            if (autoSetting?.value !== '1' || stopSetting?.value === '1') return;

            // Tìm bài viết ở trạng thái 'approved'
            const pendingPost = await dbAsync.get(`SELECT * FROM posts WHERE status = 'approved' ORDER BY id ASC LIMIT 1`);
            if (!pendingPost) return;

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
    startFbPostWorker
};
