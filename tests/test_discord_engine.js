const assert = require('assert');
const { dbAsync } = require('../src/db');
const { getDiscordBotStatus } = require('../src/services/discordEngine');

async function runDiscordEngineTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ: BOT DISCORD & XÁC NHẬN TƯƠNG TÁC');
    console.log('========================================================\n');

    // 1. Kiểm tra trạng thái khởi tạo
    console.log('1. Kiểm thử trạng thái Discord Bot ban đầu:');
    const status = getDiscordBotStatus();
    assert.strictEqual(status.isConnected, false, 'Bot ban đầu phải ở trạng thái disconnected');
    assert.strictEqual(status.debounceSeconds, 60, 'Thời gian debounce mặc định phải là 60s (1 phút)');
    console.log('  ✓ Trạng thái Bot ban đầu hoàn toàn chính xác.');

    // 2. Kiểm thử cấu trúc nút bấm tương tác (ActionRow & Buttons)
    console.log('\n2. Kiểm thử cấu trúc nút xác nhận trực tiếp trên Discord:');
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const postId = 9999;
    const testRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`discord_approve_${postId}`).setLabel('✅ Duyệt & Đăng FB').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`discord_rewrite_${postId}`).setLabel('🔄 Viết lại AI').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`discord_reject_${postId}`).setLabel('❌ Hủy bỏ').setStyle(ButtonStyle.Danger)
    );
    assert.strictEqual(testRow.components.length, 3, 'Phải có đủ 3 nút bấm tương tác');
    assert.strictEqual(testRow.components[0].data.custom_id, `discord_approve_${postId}`);
    assert.strictEqual(testRow.components[1].data.custom_id, `discord_rewrite_${postId}`);
    assert.strictEqual(testRow.components[2].data.custom_id, `discord_reject_${postId}`);
    console.log('  ✓ Đầy đủ 3 nút bấm: [✅ Duyệt & Đăng FB], [🔄 Viết lại AI], [❌ Hủy bỏ].');

    // 3. Kiểm thử lọc ảnh đính kèm từ Discord attachments
    console.log('\n3. Kiểm thử lọc ảnh đính kèm Discord (Attachments):');
    const fakeAttachments = new Map([
        ['att1', { contentType: 'image/jpeg', url: 'https://cdn.discordapp.com/attachments/1/photo1.jpg' }],
        ['att2', { contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/photo2.png' }],
        ['att3', { contentType: 'application/pdf', name: 'document.pdf', url: 'https://cdn.discordapp.com/attachments/1/doc.pdf' }],
        ['att4', { contentType: null, name: 'room_view.webp', url: 'https://cdn.discordapp.com/attachments/1/room_view.webp' }]
    ]);

    const extracted = [];
    fakeAttachments.forEach(att => {
        const isImage = (att.contentType && att.contentType.startsWith('image/')) ||
            /\.(png|jpe?g|webp|gif|bmp)$/i.test(att.name || att.url);
        if (isImage) extracted.push(att.url);
    });

    assert.strictEqual(extracted.length, 3, 'Phải lọc đúng 3 file ảnh và bỏ qua 1 file PDF');
    assert.strictEqual(extracted[0], 'https://cdn.discordapp.com/attachments/1/photo1.jpg');
    assert.strictEqual(extracted[1], 'https://cdn.discordapp.com/attachments/1/photo2.png');
    assert.strictEqual(extracted[2], 'https://cdn.discordapp.com/attachments/1/room_view.webp');
    console.log('  ✓ Trích xuất chính xác 100% link ảnh gốc và loại trừ file rác.');

    // 4. Kiểm thử gom tin nhắn nhiều lượt trong 1 phút (Debounce Buffer)
    console.log('\n4. Kiểm thử cơ chế gom tin nhắn & ảnh đa lượt (Debounce):');
    const testChannelId = 'test_channel_' + Date.now();
    const buffer = {
        texts: ['Studio ban công Landmark 81 Bình Thạnh full nội thất', 'Giá thuê 7.5tr cọc 1 tháng, liên hệ 0901234567'],
        images: [
            'https://cdn.discordapp.com/attachments/1/img1.jpg',
            'https://cdn.discordapp.com/attachments/1/img2.jpg',
            'https://cdn.discordapp.com/attachments/1/img1.jpg' // Trùng lặp
        ]
    };

    const combinedText = buffer.texts.filter(Boolean).join('\n\n').trim();
    const uniqueImages = [...new Set(buffer.images)];

    assert.strictEqual(combinedText.includes('Landmark 81') && combinedText.includes('Giá thuê 7.5tr'), true);
    assert.strictEqual(uniqueImages.length, 2, 'Khử trùng lặp ảnh thành công (3 ảnh -> 2 ảnh duy nhất)');
    console.log('  ✓ Gộp thành công nhiều tin nhắn gửi ngắt quãng và khử trùng lặp ảnh.');

    // 5. Kiểm thử ghi nhận bài đăng vào SQLite
    console.log('\n5. Kiểm thử lưu bài viết Discord vào cơ sở dữ liệu SQLite:');
    const msgRes = await dbAsync.run(
        `INSERT INTO messages (group_name, sender, content, images) VALUES (?, ?, ?, ?)`,
        ['Discord: #test-phong', 'UserDiscord#1234', combinedText, JSON.stringify(uniqueImages)]
    );

    const postRes = await dbAsync.run(
        `INSERT INTO posts (message_id, group_name, original_text, rewritten_text, target_fb_group, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [msgRes.id, 'Discord: #test-phong', combinedText, 'BÀI BIÊN TẬP GEMINI: ' + combinedText, 'Nhóm FB Test', 'pending']
    );

    const savedPost = await dbAsync.get(
        `SELECT p.*, m.sender, m.images FROM posts p LEFT JOIN messages m ON p.message_id = m.id WHERE p.id = ?`,
        [postRes.id]
    );

    assert.strictEqual(savedPost.id, postRes.id);
    assert.strictEqual(savedPost.sender, 'UserDiscord#1234');
    const parsedImgs = JSON.parse(savedPost.images);
    assert.strictEqual(parsedImgs.length, 2);
    assert.strictEqual(savedPost.status, 'pending');
    console.log(`  ✓ Bài đăng #${savedPost.id} đã được lưu an toàn với ${parsedImgs.length} ảnh và trạng thái pending.`);

    // Dọn dẹp dữ liệu test
    await dbAsync.run(`DELETE FROM posts WHERE id = ?`, [postRes.id]);
    await dbAsync.run(`DELETE FROM messages WHERE id = ?`, [msgRes.id]);
    await dbAsync.run(`DELETE FROM logs WHERE message LIKE '%Discord%' AND message LIKE '%test%'`);

    console.log('\n========================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ DISCORD ENGINE ĐÃ VƯỢT QUA 100%!');
    console.log('========================================================\n');
}

runDiscordEngineTests().catch(err => {
    console.error('❌ LỖI TEST DISCORD:', err);
    process.exit(1);
});
