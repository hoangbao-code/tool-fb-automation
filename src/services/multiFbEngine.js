const path = require('path');
const fs = require('fs');
const { dbAsync } = require('../db');
const { publishPost } = require('./fbEngine');

const profilesDir = path.join(__dirname, '..', '..', 'data', 'profiles');
if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
}

/**
 * Trả về thư mục profile của từng nhân viên
 */
function getUserProfileDir(userId) {
    const userDir = path.join(profilesDir, `user_${userId}`);
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
}

/**
 * Kiểm tra và lấy trạng thái Facebook của người dùng
 */
async function getUserFbStatus(userId) {
    const user = await dbAsync.getUserById(userId);
    if (!user) return { connected: false, name: '', status: 'user_not_found' };

    // Kiểm tra xem user có cookies hoặc phiên đã lưu hay không
    const userRow = await dbAsync.get(`SELECT fb_status, fb_name, fb_cookies FROM users WHERE id = ?`, [userId]);
    const hasCookies = Boolean(userRow && userRow.fb_cookies && userRow.fb_cookies.trim().length > 10);
    const status = hasCookies ? (userRow.fb_status || 'connected') : 'disconnected';

    return {
        connected: hasCookies && status === 'connected',
        status: status,
        name: userRow?.fb_name || (hasCookies ? 'Đã lưu phiên Facebook' : 'Chưa kết nối'),
        hasCookies: hasCookies
    };
}

/**
 * Lưu chuỗi Cookies Facebook của nhân viên
 */
async function saveUserFbCookies(userId, cookiesString, accountName = '') {
    if (!cookiesString || typeof cookiesString !== 'string') {
        throw new Error('Chuỗi cookie Facebook không hợp lệ!');
    }

    const trimmed = cookiesString.trim();
    // Bóc tách c_user làm ID nếu có
    let extractedName = accountName;
    const cUserMatch = trimmed.match(/c_user=(\d+)/);
    if (!extractedName && cUserMatch) {
        extractedName = `Facebook UID: ${cUserMatch[1]}`;
    }

    await dbAsync.updateUser(userId, {
        fb_cookies: trimmed,
        fb_name: extractedName || 'Tài khoản Facebook',
        fb_status: 'connected'
    });

    // Lưu một bản sao vào thư mục profile
    const profileFile = path.join(getUserProfileDir(userId), 'cookies.txt');
    fs.writeFileSync(profileFile, trimmed, 'utf8');

    await dbAsync.log('info', `[Multi-FB] Người dùng #${userId} đã cập nhật phiên Facebook thành công (${extractedName}).`);
    return { success: true, name: extractedName };
}

/**
 * Xóa phiên Facebook của nhân viên
 */
async function disconnectUserFb(userId) {
    await dbAsync.updateUser(userId, {
        fb_cookies: '',
        fb_name: '',
        fb_status: 'disconnected'
    });

    const profileFile = path.join(getUserProfileDir(userId), 'cookies.txt');
    if (fs.existsSync(profileFile)) {
        try { fs.unlinkSync(profileFile); } catch (e) {}
    }

    await dbAsync.log('info', `[Multi-FB] Người dùng #${userId} đã đăng xuất khỏi phiên Facebook.`);
    return { success: true };
}

/**
 * Lưu danh sách nhóm Facebook quét được của người dùng
 */
async function saveUserScannedGroups(userId, groupsList) {
    if (!Array.isArray(groupsList) || groupsList.length === 0) return { count: 0, added: 0 };

    let addedCount = 0;
    for (const g of groupsList) {
        if (!g.url || !g.name) continue;
        const cleanName = g.name.trim();
        const cleanUrl = g.url.trim();
        const memberCount = g.memberCount || '';

        // Lưu vào bảng fb_groups kèm user_id
        const res = await dbAsync.run(
            `INSERT INTO fb_groups (name, url, member_count, is_active, user_id) 
             VALUES (?, ?, ?, 1, ?)
             ON CONFLICT(url) DO UPDATE SET 
                name = excluded.name, 
                member_count = excluded.member_count,
                user_id = excluded.user_id`,
            [cleanName, cleanUrl, memberCount, userId]
        );
        if (res.changes > 0) addedCount++;
    }

    await dbAsync.log('info', `[Multi-FB] Người dùng #${userId} đã lưu ${groupsList.length} nhóm Facebook vào hồ sơ riêng.`);
    return { count: groupsList.length, added: addedCount };
}

const { loginToFacebook, fetchUserJoinedFbGroups } = require('./fbAuth');

/**
 * Đăng nhập Facebook bằng Email/SĐT + Password (+ 2FA) cho nhân viên
 */
async function loginUserWithCredentials(userId, email, password, twoFactorCode = '', accountName = '') {
    const loginResult = await loginToFacebook({ email, password, twoFactorCode });
    if (!loginResult.success) {
        return loginResult;
    }

    const saved = await saveUserFbCookies(userId, loginResult.cookies, accountName || loginResult.name);
    return {
        success: true,
        name: saved.name || loginResult.name,
        uid: loginResult.uid,
        message: 'Đăng nhập Facebook thành công!'
    };
}

/**
 * Quét danh sách nhóm Facebook từ tài khoản đã đăng nhập của nhân viên
 */
async function scanUserFbGroups(userId) {
    const userRow = await dbAsync.get(`SELECT fb_cookies, fb_status FROM users WHERE id = ?`, [userId]);
    if (!userRow || !userRow.fb_cookies || userRow.fb_cookies.trim().length < 10) {
        throw new Error('Chưa kết nối Facebook! Vui lòng đăng nhập tài khoản Facebook trước khi quét nhóm.');
    }

    const scanResult = await fetchUserJoinedFbGroups(userRow.fb_cookies);
    if (!scanResult.groups || scanResult.groups.length === 0) {
        return { success: true, count: 0, added: 0, groups: [] };
    }

    const saved = await saveUserScannedGroups(userId, scanResult.groups);
    return {
        success: true,
        count: scanResult.groups.length,
        added: saved.added,
        groups: scanResult.groups
    };
}

/**
 * Đăng bài cho người dùng cụ thể
 */
async function publishPostForUser(userId, postId, clusterId) {
    const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postId]);
    if (!post) throw new Error('Không tìm thấy bài viết #' + postId);

    // Gán user_id cho bài viết nếu chưa có
    if (!post.user_id) {
        await dbAsync.run(`UPDATE posts SET user_id = ? WHERE id = ?`, [userId, postId]);
    }

    // Gọi publishPost chính
    return await publishPost(postId, clusterId);
}

module.exports = {
    getUserProfileDir,
    getUserFbStatus,
    saveUserFbCookies,
    disconnectUserFb,
    saveUserScannedGroups,
    loginUserWithCredentials,
    scanUserFbGroups,
    publishPostForUser
};

