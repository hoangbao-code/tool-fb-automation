const assert = require('assert');
const {
    buildKeygenEmbed,
    handleDiscordKeygenCommand,
    handleDiscordKeygenButton
} = require('../src/services/discordEngine');
const { verifyLicenseKey } = require('../src/services/licenseEngine');

async function runTests() {
    console.log('\x1b[34m========================================================\x1b[0m');
    console.log('\x1b[34m🧪 KIỂM THỬ: TẠO KEY BẢN QUYỀN TRỰC TIẾP TỪ DISCORD BOT\x1b[0m');
    console.log('\x1b[34m========================================================\n\x1b[0m');

    const testHwid = 'HB-1111-2222-3333-4444';

    // 1. Kiểm thử buildKeygenEmbed
    console.log('1. Kiểm thử buildKeygenEmbed sinh embed và mẫu tin nhắn Zalo:');
    const { embed, key, zaloTemplate } = buildKeygenEmbed(testHwid, 30, 'PHPRO-6AE108F4-41D4-D1E7-A909-9886');
    assert.ok(embed.data.title.includes('PHÁT HÀNH KEY BẢN QUYỀN'));
    assert.ok(zaloTemplate.includes(testHwid));
    assert.ok(zaloTemplate.includes('PHPRO-6AE108F4-41D4-D1E7-A909-9886'));
    console.log('  ✓ Embed và mẫu Zalo được tạo chính xác và đẹp mắt.');

    // 2. Kiểm thử lệnh !keygen không tham số (Hiện hướng dẫn)
    console.log('\n2. Kiểm thử lệnh !keygen không tham số:');
    let replyPayload = null;
    const mockMessageHelp = {
        reply: async (payload) => { replyPayload = payload; }
    };
    await handleDiscordKeygenCommand(mockMessageHelp, '!keygen', { role: 'admin' });
    assert.ok(replyPayload && replyPayload.embeds && replyPayload.embeds.length > 0);
    assert.ok(replyPayload.embeds[0].data.title.includes('BỘ CÔNG CỤ CẤP BẢN QUYỀN'));
    console.log('  ✓ Bot đã trả lời embed hướng dẫn chi tiết cách dùng lệnh.');

    // 3. Kiểm thử lệnh !keygen <HWID> (Hiện 4 nút bấm chọn thời hạn)
    console.log('\n3. Kiểm thử lệnh !keygen <HWID> (Hiện 4 nút 1-chạm):');
    let buttonsPayload = null;
    const mockMessageButtons = {
        reply: async (payload) => { buttonsPayload = payload; }
    };
    await handleDiscordKeygenCommand(mockMessageButtons, `!keygen ${testHwid}`, { role: 'admin' });
    assert.ok(buttonsPayload.components && buttonsPayload.components.length === 1);
    const row = buttonsPayload.components[0];
    assert.strictEqual(row.components.length, 4, 'Phải có đủ 4 nút chọn thời hạn: 3 ngày, 30 ngày, 365 ngày, Vĩnh viễn');
    assert.ok(row.components[0].data.custom_id.includes('_3'));
    assert.ok(row.components[1].data.custom_id.includes('_30'));
    assert.ok(row.components[2].data.custom_id.includes('_365'));
    assert.ok(row.components[3].data.custom_id.includes('_0'));
    console.log('  ✓ Đã sinh đủ 4 nút bấm: [🎁 3 ngày], [⭐ 30 ngày], [👑 365 ngày], [💎 VĨNH VIỄN].');

    // 4. Kiểm thử lệnh !keygen <HWID> 30 (Tạo key 30 ngày)
    console.log('\n4. Kiểm thử lệnh !keygen <HWID> 30:');
    let key30Payload = null;
    const mockMessage30 = {
        reply: async (payload) => { key30Payload = payload; }
    };
    await handleDiscordKeygenCommand(mockMessage30, `!keygen ${testHwid} 30`, { role: 'admin' });
    assert.ok(key30Payload.embeds && key30Payload.embeds.length > 0);
    const embed30 = key30Payload.embeds[0];
    const keyField = embed30.data.fields.find(f => f.name.includes('MÃ BẢN QUYỀN'));
    assert.ok(keyField && keyField.value);
    const generatedKey30 = keyField.value.replace(/```text\n|\n```/g, '').trim();
    const verify30 = verifyLicenseKey(generatedKey30, testHwid);
    assert.strictEqual(verify30.valid, true, 'Key 30 ngày sinh từ bot Discord phải hợp lệ 100%');
    console.log(`  ✓ Key 30 ngày: ${generatedKey30} -> Hợp lệ: ${verify30.valid}`);

    // 5. Kiểm thử lệnh !key <HWID> 0 (Tạo key VĨNH VIỄN)
    console.log('\n5. Kiểm thử lệnh viết tắt !key <HWID> 0 (Vĩnh viễn):');
    let lifetimePayload = null;
    const mockMessageLifetime = {
        reply: async (payload) => { lifetimePayload = payload; }
    };
    await handleDiscordKeygenCommand(mockMessageLifetime, `!key ${testHwid} 0`, { role: 'admin' });
    const embedLt = lifetimePayload.embeds[0];
    const keyFieldLt = embedLt.data.fields.find(f => f.name.includes('MÃ BẢN QUYỀN'));
    const generatedKeyLt = keyFieldLt.value.replace(/```text\n|\n```/g, '').trim();
    assert.ok(generatedKeyLt.startsWith('PHPRO-00000000-'));
    const verifyLt = verifyLicenseKey(generatedKeyLt, testHwid);
    assert.strictEqual(verifyLt.valid, true);
    assert.strictEqual(verifyLt.isLifetime, true);
    console.log(`  ✓ Key Vĩnh viễn: ${generatedKeyLt} -> isLifetime: ${verifyLt.isLifetime}`);

    // 6. Kiểm thử tương tác nút bấm (Interaction Button)
    console.log('\n6. Kiểm thử bấm nút discord_keygen_... trên Discord:');
    let updatePayload = null;
    const mockInteraction = {
        customId: `discord_keygen_${testHwid}_90`,
        update: async (payload) => { updatePayload = payload; }
    };
    await handleDiscordKeygenButton(mockInteraction);
    assert.ok(updatePayload.embeds && updatePayload.embeds.length > 0);
    assert.strictEqual(updatePayload.components.length, 0, 'Phải gỡ bỏ nút bấm sau khi bấm');
    console.log('  ✓ Bấm nút chọn gói phát hành key thành công và tự gỡ nút bấm.');

    // 7. Kiểm thử bảo mật phân quyền (Chỉ Admin được cấp key)
    console.log('\n7. Kiểm thử phân quyền (Nhân viên staff không được cấp key):');
    let staffDeniedReply = null;
    const mockMessageStaff = {
        reply: async (text) => { staffDeniedReply = text; }
    };
    await handleDiscordKeygenCommand(mockMessageStaff, `!keygen ${testHwid} 30`, { role: 'staff' });
    assert.ok(staffDeniedReply.includes('Quyền bị từ chối'));
    console.log('  ✓ Đã chặn nhân viên thường, chỉ cho phép Admin phát hành key!');

    // 8. Kiểm thử Bảng Điều Khiển Bot (buildBotControlPanel)
    console.log('\n8. Kiểm thử Bảng Điều Khiển Bot Control Panel:');
    const { buildBotControlPanel, buildKeygenModal } = require('../src/services/discordEngine');
    const panel = buildBotControlPanel({ username: 'hoangbao', display_name: 'Hoàng Bảo' });
    assert.ok(panel.embeds && panel.embeds.length === 1);
    assert.ok(panel.components && panel.components.length === 2, 'Menu phải gồm 2 hàng nút bấm (Row 1 & Row 2)');
    const row1Buttons = panel.components[0].components;
    const row2Buttons = panel.components[1].components;
    assert.strictEqual(row1Buttons.length, 2);
    assert.strictEqual(row2Buttons.length, 2);
    assert.ok(row1Buttons.some(b => b.data.custom_id === 'discord_open_keygen_modal'), 'Phải có nút [🔑 Cấp Key Bản Quyền]');
    assert.ok(row1Buttons.some(b => b.data.custom_id === 'discord_trigger_buffer'), 'Phải có nút [⚡ Xử Lý Đăng Bài Ngay]');
    assert.ok(row2Buttons.some(b => b.data.custom_id === 'discord_btn_status'), 'Phải có nút [📊 Trạng Thái Hệ Thống]');
    assert.ok(row2Buttons.some(b => b.data.custom_id === 'discord_btn_groups'), 'Phải có nút [👥 Xem Nhóm Facebook]');
    console.log('  ✓ Menu Bảng điều khiển gồm đủ 4 nút trực quan: Cấp key, Đăng ngay, Trạng thái, Nhóm FB.');

    // 9. Kiểm thử Modal Cấp Key Bản Quyền (buildKeygenModal)
    console.log('\n9. Kiểm thử Modal Cấp Key Bản Quyền (buildKeygenModal):');
    const modal = buildKeygenModal('HB-9999-8888-7777-6666');
    assert.strictEqual(modal.data.custom_id, 'discord_modal_keygen');
    assert.strictEqual(modal.components.length, 2, 'Modal phải gồm 2 ô nhập liệu');
    console.log('  ✓ Modal nhập HWID và số ngày trực tiếp trên Discord được khởi tạo hoàn hảo.');

    console.log('\n\x1b[32m========================================================\x1b[0m');
    console.log('\x1b[32m🎉 TẤT CẢ KIỂM THỬ TÍNH NĂNG BOT DISCORD TẠO KEY ĐÃ ĐẠT 100%!\x1b[0m');
    console.log('\x1b[32m========================================================\x1b[0m');
}

runTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('\x1b[31m[Test] ❌ Thất bại:\x1b[0m', err);
    process.exit(1);
});
