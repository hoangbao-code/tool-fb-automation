process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { dbAsync } = require('../src/db');
const { publishPost, cleanupPostImages, setFbWebview } = require('../src/services/fbEngine');
const { buildPublishResultEmbed } = require('../src/services/discordEngine');

async function runTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ: BÁO BOT BÀI CHỜ DUYỆT & TỰ ĐỘNG CLEAR ẢNH');
    console.log('========================================================\n');

    const imagesDir = path.join(__dirname, '..', 'data', 'images');
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    // ---------------------------------------------------------
    // HẠNG MỤC 1: KIỂM THỬ EMBED BÁO TRỰC TIẾP LÊN BOT KHI VÀO HÀNG CHỜ PHÊ DUYỆT
    // ---------------------------------------------------------
    console.log('1. Kiểm thử Embed Discord khi bài viết vào hàng chờ phê duyệt (pending_approval):');

    const samplePendingGroups = [
        {
            groupId: 101,
            name: 'Hội Mua Bán Nhà Đất Thủ Đức',
            url: 'https://www.facebook.com/groups/thuduc_bds/',
            postUrl: 'https://www.facebook.com/groups/thuduc_bds/pending_posts',
            status: 'pending_approval',
            message: 'Bài viết đã được gửi và đang chờ Quản trị viên duyệt.'
        },
        {
            groupId: 102,
            name: 'Phòng Trọ Quận 9 Giá Rẻ',
            url: 'https://www.facebook.com/groups/q9_phongtro/',
            postUrl: 'https://www.facebook.com/groups/q9_phongtro/pending_posts',
            status: 'pending_approval',
            message: 'Bài viết đã được gửi và đang chờ Quản trị viên duyệt.'
        }
    ];

    const pendingEmbed = buildPublishResultEmbed(999, 'Cụm BĐS Khu Đông', samplePendingGroups, []);
    assert.strictEqual(pendingEmbed.data.title, '⏳ BÀI VIẾT #999 ĐANG CHỜ PHÊ DUYỆT!', 'Tiêu đề phải thể hiện rõ đang chờ phê duyệt');
    assert.strictEqual(pendingEmbed.data.color, 0xf39c12, 'Màu của Embed phải là màu vàng cam cảnh báo');
    assert.ok(pendingEmbed.data.description.includes('hàng chờ Quản trị viên phê duyệt'), 'Nội dung phải báo rõ đang chờ QTV duyệt');
    assert.ok(pendingEmbed.data.description.includes('pending_posts'), 'Phải chứa link xem bài đang chờ duyệt');
    assert.ok(pendingEmbed.data.description.includes('ĐANG CHỜ PHÊ DUYỆT'), 'Phải gắn nhãn trạng thái ĐANG CHỜ PHÊ DUYỆT');
    console.log('  ✓ Embed hiển thị chính xác khi 100% nhóm rơi vào hàng chờ phê duyệt:');
    console.log(`    - Tiêu đề: ${pendingEmbed.data.title}`);
    console.log(`    - Màu sắc: 0xf39c12 (Vàng cam)`);

    // Kiểm thử trường hợp hỗn hợp (Một số đã đăng ngay, một số chờ duyệt)
    console.log('\n2. Kiểm thử Embed Discord khi kết quả hỗn hợp (Có nhóm đăng ngay, có nhóm chờ duyệt):');
    const sampleMixedGroups = [
        {
            groupId: 101,
            name: 'Nhóm Tự Do Đăng',
            url: 'https://www.facebook.com/groups/freedom_group/',
            postUrl: 'https://www.facebook.com/groups/freedom_group/posts/11223344/',
            status: 'posted',
            message: 'Đã đăng bài thành công lên Facebook!'
        },
        {
            groupId: 102,
            name: 'Nhóm Có Kiểm Duyệt',
            url: 'https://www.facebook.com/groups/moderated_group/',
            postUrl: 'https://www.facebook.com/groups/moderated_group/pending_posts',
            status: 'pending_approval',
            message: 'Bài viết đã được gửi và đang chờ Quản trị viên duyệt.'
        }
    ];

    const mixedEmbed = buildPublishResultEmbed(1000, 'Tất cả nhóm', sampleMixedGroups, []);
    assert.ok(mixedEmbed.data.title.includes('1 đã đăng, 1 chờ duyệt'), 'Tiêu đề phải tóm tắt số lượng đã đăng và chờ duyệt');
    assert.strictEqual(mixedEmbed.data.color, 0x3498db, 'Màu sắc phải là xanh lam (hỗn hợp)');
    assert.ok(mixedEmbed.data.description.includes('ĐÃ ĐĂNG CÔNG KHAI'));
    assert.ok(mixedEmbed.data.description.includes('ĐANG CHỜ PHÊ DUYỆT'));
    console.log('  ✓ Embed hiển thị chính xác trường hợp hỗn hợp (đăng ngay + chờ duyệt).');

    // Kiểm thử trường hợp 100% đã đăng công khai
    console.log('\n3. Kiểm thử Embed Discord khi 100% nhóm đăng công khai trực tiếp:');
    const samplePostedGroups = [
        {
            groupId: 103,
            name: 'Nhóm Đăng Nhanh Sài Gòn',
            url: 'https://www.facebook.com/groups/fast_post/',
            postUrl: 'https://www.facebook.com/groups/fast_post/posts/55667788/',
            status: 'posted'
        }
    ];
    const successEmbed = buildPublishResultEmbed(1001, 'Nhóm VIP', samplePostedGroups, []);
    assert.strictEqual(successEmbed.data.title, '🎉 ĐÃ ĐĂNG BÀI #1001 THÀNH CÔNG!');
    assert.strictEqual(successEmbed.data.color, 0x2ecc71, 'Màu xanh lá');
    console.log('  ✓ Embed hiển thị chính xác khi đăng thành công công khai.');

    // ---------------------------------------------------------
    // HẠNG MỤC 2: KIỂM THỬ TỰ ĐỘNG XÓA / DỌN DẸP ẢNH ĐÃ GIẢI NÉN SAU KHI ĐĂNG
    // ---------------------------------------------------------
    console.log('\n4. Kiểm thử Tự Động Xóa / Dọn Dẹp Ảnh Tạm & Ảnh Giải Nén Sau Khi Đăng:');

    // Tạo các file ảnh giả lập được giải nén từ ZIP vào data/images
    const testPostId = 77777;
    const testImgFile1 = path.join(imagesDir, `post_${testPostId}_zip_1_1_phongngu_${Date.now()}.jpg`);
    const testImgFile2 = path.join(imagesDir, `post_${testPostId}_zip_1_2_bancong_${Date.now()}.png`);
    const testImgFile3 = path.join(imagesDir, `post_${testPostId}_img_1_${Date.now()}.jpg`);

    fs.writeFileSync(testImgFile1, 'DUMMY_IMAGE_BINARY_DATA_1_TEST_TEST');
    fs.writeFileSync(testImgFile2, 'DUMMY_IMAGE_BINARY_DATA_2_TEST_TEST');
    fs.writeFileSync(testImgFile3, 'DUMMY_IMAGE_BINARY_DATA_3_TEST_TEST');

    assert.ok(fs.existsSync(testImgFile1), 'Ảnh 1 phải tồn tại trên đĩa');
    assert.ok(fs.existsSync(testImgFile2), 'Ảnh 2 phải tồn tại trên đĩa');
    assert.ok(fs.existsSync(testImgFile3), 'Ảnh 3 phải tồn tại trên đĩa');
    console.log('  ✓ Đã tạo 3 file ảnh giải nén mẫu trên đĩa để kiểm thử.');

    // Gọi trực tiếp cleanupPostImages
    const cleanupResult = await cleanupPostImages([testImgFile1, testImgFile2], testPostId);
    assert.strictEqual(cleanupResult.count, 3, 'Phải dọn dẹp sạch cả 3 ảnh thuộc postId này');
    assert.ok(cleanupResult.freedBytes > 0, 'Dung lượng giải phóng phải lớn hơn 0');

    assert.strictEqual(fs.existsSync(testImgFile1), false, 'Ảnh 1 phải đã bị xóa khỏi đĩa');
    assert.strictEqual(fs.existsSync(testImgFile2), false, 'Ảnh 2 phải đã bị xóa khỏi đĩa');
    assert.strictEqual(fs.existsSync(testImgFile3), false, 'Ảnh 3 (tìm theo postId) phải đã bị xóa khỏi đĩa');
    console.log(`  ✓ cleanupPostImages đã dọn dẹp ${cleanupResult.count} file ảnh tạm, giải phóng ${cleanupResult.freedBytes} bytes thành công!`);

    // ---------------------------------------------------------
    // HẠNG MỤC 3: KIỂM THỬ TÍCH HỢP QUY TRÌNH PUBLISHPOST VỪA BÁO TRẠNG THÁI VỪA CLEAR ẢNH
    // ---------------------------------------------------------
    console.log('\n5. Kiểm thử Tích Hợp publishPost tự động dọn dẹp ảnh sau khi đăng bài:');

    // Tạo nhóm FB mẫu
    const groupUrl = 'https://www.facebook.com/groups/test_cleanup_group_999/';
    await dbAsync.run(`DELETE FROM fb_groups WHERE url = ?`, [groupUrl]);
    const grpRes = await dbAsync.run(
        `INSERT INTO fb_groups (name, url, is_active) VALUES (?, ?, 1)`,
        ['Nhóm Test Cleanup Ảnh', groupUrl]
    );
    const testGrpId = grpRes.id;

    // Tạo file ảnh mẫu cho bài viết này
    const autoImgFile = path.join(imagesDir, `post_auto_cleanup_${Date.now()}.jpg`);
    fs.writeFileSync(autoImgFile, 'BINARY_IMAGE_DATA_AUTO_CLEANUP');
    assert.ok(fs.existsSync(autoImgFile));

    // Tạo bài viết mẫu có ảnh này
    const postRecord = await dbAsync.run(
        `INSERT INTO posts (group_name, original_text, rewritten_text, status, images, target_cluster_id) VALUES (?, ?, ?, 'approved', ?, ?)`,
        ['Nhóm Test', 'Cho thuê phòng trọ', 'Cho thuê phòng trọ VIP', JSON.stringify([autoImgFile]), `group_${testGrpId}`]
    );
    const pubTestPostId = postRecord.id;

    // Giả lập Webview trả về kết quả đang chờ duyệt
    const mockWv = {
        isDestroyed: () => false,
        loadURL: async () => {},
        executeJavaScript: async () => ({
            success: true,
            status: 'pending_approval',
            postUrl: `${groupUrl}pending_posts`,
            message: 'Bài viết đã được gửi và đang chờ Quản trị viên duyệt.'
        })
    };
    setFbWebview(mockWv);

    const pubRes = await publishPost(pubTestPostId);
    assert.strictEqual(pubRes.success, true);
    assert.strictEqual(pubRes.groups[0].status, 'pending_approval');
    assert.ok(pubRes.groups[0].postUrl.includes('pending_posts'));

    // Kiểm tra file ảnh tự động dọn dẹp
    assert.strictEqual(fs.existsSync(autoImgFile), false, 'File ảnh phải được tự động xóa sau khi đăng bài thành công!');
    console.log('  ✓ publishPost đã đăng bài (vào hàng chờ duyệt) và tự động dọn dẹp sạch file ảnh trên đĩa!');

    // Dọn dẹp DB test
    await dbAsync.run(`DELETE FROM posts WHERE id = ?`, [pubTestPostId]);
    await dbAsync.run(`DELETE FROM fb_groups WHERE id = ?`, [testGrpId]);
    setFbWebview(null);

    console.log('\n========================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ BÁO BOT CHỜ DUYỆT & CLEAR ẢNH ĐÃ VƯỢT QUA 100%!');
    console.log('========================================================\n');
}

runTests().catch(err => {
    console.error('❌ LỖI KIỂM THỬ:', err);
    process.exit(1);
});
