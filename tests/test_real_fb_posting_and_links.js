const assert = require('assert');
const { dbAsync } = require('../src/db');
const { publishPost, setFbWebview } = require('../src/services/fbEngine');
const { executeGroupPost, FB_DOM_POST_SCRIPT } = require('../src/services/fbPoster');

process.env.NODE_ENV = 'test';

async function runTests() {
    console.log('========================================================');
    console.log('🧪 KIỂM THỬ: ĐĂNG BÀI THỰC TẾ LÊN FB & BÓC TÁCH LINK BÀI VIẾT');
    console.log('========================================================\n');

    // 1. Kiểm thử FB_DOM_POST_SCRIPT tạo mã JavaScript DOM hợp lệ
    console.log('1. Kiểm thử kịch bản DOM Facebook:');
    const testContent = 'Phòng trọ Tân Bình 35m2 full nội thất giá 4.5tr.\nLiên hệ: 0901234567';
    const script = FB_DOM_POST_SCRIPT(testContent);
    assert.ok(script.includes(JSON.stringify(testContent)), 'Script phải chứa nội dung cần đăng đã được escape JSON');
    assert.ok(script.includes('extractLatestPostLink'), 'Script phải chứa hàm bóc tách link bài viết');
    assert.ok(script.includes('findComposerTrigger'), 'Script phải chứa hàm tìm nút mở khung soạn bài');
    assert.ok(script.includes('findSubmitButton'), 'Script phải chứa hàm tìm nút Đăng');
    console.log('  ✓ FB_DOM_POST_SCRIPT sinh mã an toàn, hỗ trợ bóc tách permalink và xử lý duyệt bài.');

    // 2. Kiểm thử quy trình publishPost với Webview giả lập trả về link bài viết thực tế
    console.log('\n2. Kiểm thử quy trình publishPost và lưu link bài viết thực tế:');
    
    // Tạo 1 nhóm Facebook mẫu
    await dbAsync.run(`DELETE FROM fb_groups WHERE url LIKE '%test_posting_group%'`);
    const grpRes = await dbAsync.run(
        `INSERT INTO fb_groups (name, url, member_count, is_active) VALUES (?, ?, ?, 1)`,
        ['Nhóm Test BĐS Sài Gòn', 'https://www.facebook.com/groups/test_posting_group_123456/', '50K']
    );
    const testGroupId = grpRes.id;

    // Tạo 1 bài viết mẫu
    const postRes = await dbAsync.run(
        `INSERT INTO posts (group_name, original_text, rewritten_text, status, target_cluster_id) VALUES (?, ?, ?, 'approved', ?)`,
        ['Zalo Nhà Đất Test', testContent, testContent, `group_${testGroupId}`]
    );
    const testPostId = postRes.id;

    // Giả lập Webview trả về permalink bài viết thật
    const mockWebview = {
        isDestroyed: () => false,
        loadURL: async (url) => {},
        executeJavaScript: async (code) => {
            return {
                success: true,
                status: 'posted',
                postUrl: `https://www.facebook.com/groups/test_posting_group_123456/posts/888999111222/`,
                message: 'Đã đăng bài thành công lên Facebook!'
            };
        }
    };

    setFbWebview(mockWebview);

    // Thực thi đăng bài
    const publishRes = await publishPost(testPostId);
    assert.ok(publishRes.success, 'publishPost phải trả về success: true');
    assert.strictEqual(publishRes.groupCount, 1, 'Số nhóm đăng thành công phải là 1');
    assert.strictEqual(publishRes.groups[0].postUrl, 'https://www.facebook.com/groups/test_posting_group_123456/posts/888999111222/');

    // Kiểm tra dữ liệu được lưu trong database
    const savedPost = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [testPostId]);
    assert.strictEqual(savedPost.status, 'posted', 'Trạng thái bài viết phải chuyển sang posted sau khi đăng thực tế');
    assert.ok(savedPost.post_links, 'Cột post_links phải được cập nhật');

    const parsedLinks = JSON.parse(savedPost.post_links);
    assert.strictEqual(parsedLinks.length, 1);
    assert.strictEqual(parsedLinks[0].postUrl, 'https://www.facebook.com/groups/test_posting_group_123456/posts/888999111222/', 'Link bài viết chi tiết phải được lưu vào post_links');
    assert.strictEqual(parsedLinks[0].status, 'posted');
    console.log(`  ✓ Đăng thành công: Đã bóc tách link bài viết: ${parsedLinks[0].postUrl}`);

    // 3. Kiểm thử trường hợp bài viết chờ duyệt (pending_approval)
    console.log('\n3. Kiểm thử trường hợp bài viết vào nhóm kiểm duyệt (pending_approval):');
    const mockWebviewPending = {
        isDestroyed: () => false,
        loadURL: async (url) => {},
        executeJavaScript: async (code) => {
            return {
                success: true,
                status: 'pending_approval',
                postUrl: `https://www.facebook.com/groups/test_posting_group_123456/pending_posts`,
                message: 'Bài viết đã được gửi và đang chờ Quản trị viên duyệt.'
            };
        }
    };
    setFbWebview(mockWebviewPending);

    const postRes2 = await dbAsync.run(
        `INSERT INTO posts (group_name, original_text, rewritten_text, status, target_cluster_id) VALUES (?, ?, ?, 'approved', ?)`,
        ['Zalo Căn Hộ Test', testContent, testContent, `group_${testGroupId}`]
    );
    const testPostId2 = postRes2.id;

    const pubRes2 = await publishPost(testPostId2);
    assert.ok(pubRes2.success);
    const savedPost2 = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [testPostId2]);
    const parsedLinks2 = JSON.parse(savedPost2.post_links);
    assert.strictEqual(parsedLinks2[0].status, 'pending_approval');
    assert.ok(parsedLinks2[0].postUrl.includes('pending_posts'));
    console.log(`  ✓ Nhận diện đúng trạng thái chờ duyệt: ${parsedLinks2[0].postUrl}`);

    // 4. Kiểm thử trường hợp thất bại hoàn toàn (bị khóa đăng) -> Không được báo hoàn thành ảo
    console.log('\n4. Kiểm thử trường hợp thất bại (Không được báo hoàn thành ảo):');
    const mockWebviewFailed = {
        isDestroyed: () => false,
        loadURL: async (url) => {},
        executeJavaScript: async (code) => {
            return {
                success: false,
                error: 'Bạn tạm thời bị chặn đăng bài vào nhóm này (Spam filter).'
            };
        }
    };
    setFbWebview(mockWebviewFailed);

    const postRes3 = await dbAsync.run(
        `INSERT INTO posts (group_name, original_text, rewritten_text, status, target_cluster_id) VALUES (?, ?, ?, 'approved', ?)`,
        ['Zalo Thất Bại Test', testContent, testContent, `group_${testGroupId}`]
    );
    const testPostId3 = postRes3.id;

    const pubRes3 = await publishPost(testPostId3);
    assert.strictEqual(pubRes3.success, false, 'publishPost phải trả về false khi không đăng được');
    const savedPost3 = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [testPostId3]);
    assert.strictEqual(savedPost3.status, 'failed', 'Bài viết phải ở trạng thái failed (KHÔNG được báo posted)');
    assert.ok(savedPost3.error_message.includes('tạm thời bị chặn'), 'error_message phải ghi nhận đúng lỗi từ Facebook');
    console.log(`  ✓ Xử lý chính xác: Bài viết thất bại chuyển sang 'failed', không báo hoàn thành ảo!`);

    // Dọn dẹp dữ liệu test
    await dbAsync.run(`DELETE FROM posts WHERE id IN (?, ?, ?)`, [testPostId, testPostId2, testPostId3]);
    await dbAsync.run(`DELETE FROM fb_groups WHERE id = ?`, [testGroupId]);
    setFbWebview(null);

    console.log('\n========================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ ĐĂNG BÀI FB & BÓC TÁCH LINK ĐÃ VƯỢT QUA 100%!');
    console.log('========================================================\n');
}

runTests().catch(err => {
    console.error('LỖI KIỂM THỬ:', err);
    process.exit(1);
});
