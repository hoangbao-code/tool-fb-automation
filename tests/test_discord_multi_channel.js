process.env.NODE_ENV = 'test';
const assert = require('assert');
const { dbAsync } = require('../src/db');
const { getUserForDiscordChannel } = require('../src/services/discordEngine');

async function runMultiChannelDiscordTest() {
    console.log('========================================================');
    console.log('🧪 KIỂM THỬ: ĐA KÊNH DISCORD & KHÔNG XUNG ĐỘT NHÂN VIÊN');
    console.log('========================================================\n');

    try {
        // 1. Tạo nhân viên mẫu kèm kênh Discord riêng
        const testChannelAdmin = '1538337526530707548';
        const testChannelStaff = '998877665544332211';
        const testChannelStranger = '111111111111111111';

        const testStaff = await dbAsync.createUser({
            username: 'staff_discord_test_' + Date.now(),
            password: 'pass123456_test',
            displayName: 'Nhân Viên Test Discord',
            role: 'staff',
            discordChannelId: testChannelStaff
        });
        assert.ok(testStaff.id, 'Tạo nhân viên thành công');
        console.log(`  ✓ Đã tạo nhân viên #${testStaff.id} với kênh Discord: ${testChannelStaff}`);

        // 2. Kiểm thử nhận diện User theo Kênh
        console.log('\n2. Kiểm thử định tuyến kênh Discord sang đúng User:');
        
        // Kênh của nhân viên
        const matchedStaff = await getUserForDiscordChannel(testChannelStaff);
        assert.ok(matchedStaff, 'Phải tìm thấy user cho kênh nhân viên');
        assert.strictEqual(matchedStaff.id, testStaff.id, 'ID nhân viên phải khớp chính xác');
        console.log(`  ✓ Kênh ${testChannelStaff} -> Đúng nhân viên #${matchedStaff.id} (${matchedStaff.display_name})`);

        // Kênh lạ
        const matchedStranger = await getUserForDiscordChannel(testChannelStranger);
        assert.strictEqual(matchedStranger, null, 'Kênh lạ không đăng ký phải trả về null để bot bỏ qua');
        console.log(`  ✓ Kênh lạ ${testChannelStranger} -> Bỏ qua an toàn (null), không xung đột`);

        // 3. Kiểm thử phân quyền cụm nhóm và bài viết theo user
        console.log('\n3. Kiểm thử phân quyền cụm nhóm cho nhân viên:');
        const clusterStaff = await dbAsync.saveCluster({
            name: 'Cụm Nhân Viên Test ' + Date.now(),
            description: 'Cụm riêng của nhân viên',
            userId: testStaff.id
        });
        assert.ok(clusterStaff.id, 'Tạo cụm riêng thành công');

        const staffClusters = await dbAsync.getClusters(testStaff.id);
        const hasStaffCluster = staffClusters.some(c => c.id === clusterStaff.id);
        assert.strictEqual(hasStaffCluster, true, 'Nhân viên phải thấy cụm của mình');
        console.log(`  ✓ Nhân viên #${testStaff.id} lấy danh sách cụm thành công (${staffClusters.length} cụm)`);

        // 4. Kiểm thử lưu bài viết từ Discord kèm user_id
        console.log('\n4. Kiểm thử lưu bài viết Discord gắn đúng user_id:');
        const postRes = await dbAsync.run(
            `INSERT INTO posts (group_name, original_text, rewritten_text, target_fb_group, status, images, user_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['Discord: #kenh-nhan-vien', 'Nội dung test nhân viên', 'Nội dung AI', 'Cụm test', 'pending', '[]', testStaff.id]
        );
        const savedPost = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postRes.id]);
        assert.strictEqual(savedPost.user_id, testStaff.id, 'Bài viết phải lưu đúng user_id của nhân viên');
        console.log(`  ✓ Bài đăng #${savedPost.id} gắn đúng user_id = ${savedPost.user_id}`);

        // Dọn dẹp dữ liệu test
        await dbAsync.run(`DELETE FROM posts WHERE id = ?`, [postRes.id]);
        await dbAsync.deleteCluster(clusterStaff.id);
        await dbAsync.deleteUser(testStaff.id);
        console.log('  ✓ Dọn dẹp dữ liệu kiểm thử sạch sẽ.');

        console.log('\n========================================================');
        console.log('🎉 TẤT CẢ KIỂM THỬ ĐA KÊNH DISCORD ĐÃ VƯỢT QUA 100%!');
        console.log('========================================================');
    } catch (err) {
        console.error('❌ Kiểm thử thất bại:', err);
        process.exit(1);
    }
}

runMultiChannelDiscordTest();
