const { dbAsync } = require('../db');
const { broadcastEvent } = require('./events');

let isWorkerRunning = false;

/**
 * Xuất bản bài viết lên các nhóm Facebook đã chỉ định
 */
async function publishPost(postId) {
    const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postId]);
    if (!post) throw new Error('Không tìm thấy bài viết ID: ' + postId);

    const activeFbGroups = await dbAsync.all(`SELECT * FROM fb_groups WHERE is_active = 1`);
    if (activeFbGroups.length === 0) {
        throw new Error('Chưa có nhóm Facebook nào được kích hoạt. Hãy thêm nhóm trong tab Facebook Groups.');
    }

    await dbAsync.log('info', `Bắt đầu đăng bài #${postId} lên ${activeFbGroups.length} nhóm Facebook.`);

    // Lấy cài đặt chế độ đăng
    const modeRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'fb_posting_mode'`);
    const mode = modeRow?.value || 'assisted';

    try {
        if (mode === 'assisted') {
            // Chế độ Trợ lực thông minh: Mở các nhóm trên trình duyệt mặc định kèm bài viết
            const open = (await import('open')).default;
            for (const grp of activeFbGroups) {
                await dbAsync.log('info', `[Trợ lực] Đang mở nhóm: ${grp.name} (${grp.url})`);
                await open(grp.url);
            }
        }

        // Cập nhật trạng thái thành công
        await dbAsync.run(
            `UPDATE posts SET status = 'posted', posted_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [postId]
        );

        broadcastEvent('post_published', { id: postId, status: 'posted', time: new Date().toLocaleTimeString('vi-VN') });
        await dbAsync.log('info', `Đã xuất bản thành công bài đăng #${postId}.`);
        return { success: true, count: activeFbGroups.length };

    } catch (err) {
        await dbAsync.run(
            `UPDATE posts SET status = 'failed', error_message = ? WHERE id = ?`,
            [err.message, postId]
        );
        broadcastEvent('post_failed', { id: postId, error: err.message });
        await dbAsync.log('error', `Lỗi đăng bài #${postId}: ${err.message}`);
        throw err;
    }
}

/**
 * Worker chạy nền tự động xử lý hàng đợi bài đăng đã được duyệt ('approved')
 */
function startPostWorker() {
    if (isWorkerRunning) return;
    isWorkerRunning = true;

    setInterval(async () => {
        try {
            const autoSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'auto_post_enabled'`);
            if (autoSetting?.value !== '1') return;

            // Tìm bài viết ở trạng thái 'approved' chưa đăng
            const pendingPost = await dbAsync.get(`SELECT * FROM posts WHERE status = 'approved' ORDER BY id ASC LIMIT 1`);
            if (!pendingPost) return;

            // Đọc cấu hình giãn cách ngẫu nhiên (Jitter)
            const minRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'delay_min_seconds'`);
            const maxRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'delay_max_seconds'`);
            const minSec = parseInt(minRow?.value || '180', 10);
            const maxSec = parseInt(maxRow?.value || '480', 10);
            const delaySec = Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;

            await dbAsync.log('info', `Hàng đợi: Chuẩn bị tự động đăng bài #${pendingPost.id} sau ${delaySec} giây (chống spam).`);
            
            setTimeout(async () => {
                try {
                    await publishPost(pendingPost.id);
                } catch (e) {
                    console.error('Worker publish error:', e);
                }
            }, delaySec * 1000);

        } catch (err) {
            console.error('Worker loop error:', err);
        }
    }, 30000); // Kiểm tra mỗi 30 giây
}

module.exports = { publishPost, startPostWorker };
