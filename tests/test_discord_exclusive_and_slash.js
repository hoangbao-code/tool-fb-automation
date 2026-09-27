const assert = require('assert');
const {
    checkChannelAndUserAccess,
    buildBotControlPanel,
    handleDiscordKeygenCommand,
    buildCreatePostModal
} = require('../src/services/discordEngine');
const { dbAsync } = require('../src/db');
const { verifyLicenseKey } = require('../src/services/licenseEngine');

async function runTests() {
    console.log('\x1b[34m========================================================\x1b[0m');
    console.log('\x1b[34m🧪 KIỂM THỬ: KÊNH DISCORD ĐỘC QUYỀN & SLASH COMMANDS (/)\x1b[0m');
    console.log('\x1b[34m========================================================\n\x1b[0m');

    const testChannelId = '123456789012345678';
    const hoangBaoUser = { id: '9988776655', tag: 'HoangBao#0001', username: 'hoangbao' };
    const strangerUser = { id: '1122334455', tag: 'Stranger#1234', username: 'stranger' };

    const originalOwner = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_owner_user_id'`);
    // Reset setting discord_owner_user_id trước khi test
    await dbAsync.run(`DELETE FROM settings WHERE key = 'discord_owner_user_id'`);

    // 1. Kiểm thử tự động nhận diện và khóa kênh độc quyền cho Hoàng Bảo
    console.log('1. Kiểm thử tự động khóa kênh độc quyền khi Hoàng Bảo thao tác:');
    const access1 = await checkChannelAndUserAccess(testChannelId, hoangBaoUser);
    assert.strictEqual(access1.allowed, true, 'Hoàng Bảo phải được phép truy cập');

    const savedOwner = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_owner_user_id'`);
    assert.strictEqual(savedOwner?.value, hoangBaoUser.id, 'Hệ thống phải tự động lưu ID của Hoàng Bảo làm chủ sở hữu');
    console.log(`  ✓ Đã tự động lưu chủ sở hữu độc quyền: ${hoangBaoUser.tag} (ID: ${hoangBaoUser.id})`);

    // 2. Kiểm thử người lạ vào kênh thao tác -> BỊ CHẶN 100%
    console.log('\n2. Kiểm thử người lạ vào kênh thao tác:');
    const accessStranger = await checkChannelAndUserAccess(testChannelId, strangerUser);
    assert.strictEqual(accessStranger.allowed, false, 'Người lạ không được phép thao tác');
    assert.strictEqual(accessStranger.reason, 'not_owner');
    assert.ok(accessStranger.error.includes('KÊNH DISCORD NÀY LÀ CỦA RIÊNG HOÀNG BẢO'));
    console.log(`  ✓ Người lạ bị chặn ngay lập tức với cảnh báo: "${accessStranger.error.substring(0, 45)}..."`);

    // 3. Kiểm thử Slash Command `/menu`
    console.log('\n3. Kiểm thử Slash Command `/menu`:');
    const panel = buildBotControlPanel({ display_name: 'Hoàng Bảo', username: 'hoangbao' });
    assert.ok(panel.embeds && panel.embeds.length === 1);
    assert.ok(panel.embeds[0].data.title.includes('BẢNG ĐIỀU KHIỂN POSTHUB PRO'));
    assert.strictEqual(panel.components.length, 2, 'Bảng điều khiển phải gồm 2 hàng nút bấm');
    console.log('  ✓ Slash Command `/menu` hiển thị bảng điều khiển kèm đầy đủ các nút bấm.');

    // 4. Kiểm thử Slash Command `/keygen` (hoạt động qua Interaction)
    console.log('\n4. Kiểm thử Slash Command `/keygen` qua Interaction:');
    const testHwid = 'HB-AAAA-BBBB-CCCC-DDDD';
    let replyData = null;
    const mockInteraction = {
        reply: async (payload) => { replyData = payload; },
        followUp: async (payload) => { replyData = payload; },
        replied: false,
        deferred: false
    };

    await handleDiscordKeygenCommand(mockInteraction, `!keygen ${testHwid} 30`, { role: 'admin' });
    assert.ok(replyData && replyData.embeds && replyData.embeds.length > 0);
    const keyField = replyData.embeds[0].data.fields.find(f => f.name.includes('MÃ BẢN QUYỀN'));
    const generatedKey = keyField.value.replace(/```text\n|\n```/g, '').trim();
    const verifyResult = verifyLicenseKey(generatedKey, testHwid);
    assert.strictEqual(verifyResult.valid, true, 'Key sinh qua Slash Command phải hợp lệ 100%');
    console.log(`  ✓ Slash Command \`/keygen\` tạo key thành công: ${generatedKey} (Hợp lệ: true)`);

    // 5. Kiểm thử Modal Soạn & Đăng bài mới (buildCreatePostModal)
    console.log('\n5. Kiểm thử Modal Soạn bài viết bằng nút bấm:');
    const postModal = buildCreatePostModal();
    assert.strictEqual(postModal.data.custom_id, 'discord_modal_create_post');
    assert.ok(postModal.data.title.includes('Gửi Nội Dung Up Bài'));
    assert.strictEqual(postModal.components.length, 2, 'Modal phải gồm 2 trường nhập: Nội dung và link ảnh');
    console.log('  ✓ Modal Soạn & Đăng bài Facebook được cấu hình chính xác và đầy đủ các trường.');

    // Khôi phục owner ban đầu
    if (originalOwner && originalOwner.value) {
        await dbAsync.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('discord_owner_user_id', ?)", [originalOwner.value]);
    } else {
        await dbAsync.run("DELETE FROM settings WHERE key = 'discord_owner_user_id'");
    }

    console.log('\n\x1b[32m========================================================\x1b[0m');
    console.log('\x1b[32m🎉 TẤT CẢ KIỂM THỬ KÊNH ĐỘC QUYỀN & SLASH COMMANDS ĐÃ ĐẠT 100%!\x1b[0m');
    console.log('\x1b[32m========================================================\x1b[0m');
}

runTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('\x1b[31m[Test] ❌ Thất bại:\x1b[0m', err);
    process.exit(1);
});
