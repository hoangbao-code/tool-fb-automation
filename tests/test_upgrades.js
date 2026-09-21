const assert = require('assert');
const { dbAsync } = require('../src/db');
const { isWithinGoldenHours } = require('../src/services/fbEngine');
const { spinPostForGroup } = require('../src/services/gemini');
const { processZaloMessage } = require('../src/services/zaloEngine');

async function runTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ BỘ TÍNH NĂNG NÂNG CẤP POSTHUB PC V2.1');
    console.log('========================================================\n');

    // 1. Kiểm thử Smart Scheduler (Khung Giờ Vàng)
    console.log('1. Kiểm thử Smart Scheduler (Khung Giờ Vàng):');
    const slots = [
        { start: '08:00', end: '09:30' },
        { start: '11:30', end: '13:00' },
        { start: '19:30', end: '21:30' }
    ];

    const d1 = new Date('2026-09-22T08:45:00');
    assert.strictEqual(isWithinGoldenHours(slots, d1), true, '08:45 phải nằm trong khung giờ sáng 08:00 - 09:30');
    console.log('  ✓ 08:45: Nằm trong Khung Giờ Vàng sáng (ĐÚNG)');

    const d2 = new Date('2026-09-22T10:15:00');
    assert.strictEqual(isWithinGoldenHours(slots, d2), false, '10:15 không nằm trong khung giờ vàng');
    console.log('  ✓ 10:15: Không nằm trong Khung Giờ Vàng (ĐÚNG)');

    const d3 = new Date('2026-09-22T12:15:00');
    assert.strictEqual(isWithinGoldenHours(slots, d3), true, '12:15 phải nằm trong khung giờ trưa 11:30 - 13:00');
    console.log('  ✓ 12:15: Nằm trong Khung Giờ Vàng trưa (ĐÚNG)');

    const d4 = new Date('2026-09-22T20:30:00');
    assert.strictEqual(isWithinGoldenHours(slots, d4), true, '20:30 phải nằm trong khung giờ tối 19:30 - 21:30');
    console.log('  ✓ 20:30: Nằm trong Khung Giờ Vàng tối (ĐÚNG)');

    const d5 = new Date('2026-09-22T23:00:00');
    assert.strictEqual(isWithinGoldenHours(slots, d5), false, '23:00 không nằm trong khung giờ vàng');
    console.log('  ✓ 23:00: Không nằm trong Khung Giờ Vàng (ĐÚNG)');

    // 2. Kiểm thử AI Unique Spin Content
    console.log('\n2. Kiểm thử AI Spin Content (Biến thể chống spam đa nhóm):');
    const basePost = 'Cần bán gấp nhà phố 3 tầng mặt tiền Q7, SHR chính chủ.';
    const spin1 = spinPostForGroup(basePost, 'Nhóm BĐS Sài Gòn', 0);
    const spin2 = spinPostForGroup(basePost, 'Chợ Nhà Đất Hà Nội', 1);

    assert(spin1.includes(basePost), 'Spin 1 phải giữ nguyên nội dung gốc');
    assert(spin2.includes(basePost), 'Spin 2 phải giữ nguyên nội dung gốc');
    assert.notStrictEqual(spin1, spin2, 'Spin 1 và Spin 2 phải tạo ra biến thể khác nhau để tránh spam checkpoint');
    console.log('  ✓ Biến thể 1:\n    ' + spin1.replace(/\n+/g, ' | '));
    console.log('  ✓ Biến thể 2:\n    ' + spin2.replace(/\n+/g, ' | '));
    console.log('  ✓ Unique Spin Content tạo thành công các biến thể khác nhau!');

    // 3. Kiểm thử Sao lưu & Phục hồi dữ liệu (Backup / Restore)
    console.log('\n3. Kiểm thử Sao lưu & Phục hồi dữ liệu (Backup / Restore):');
    const backup = await dbAsync.exportBackup();
    assert.strictEqual(backup.version, '2.1.0');
    assert(Array.isArray(backup.settings), 'Settings phải là mảng');
    assert(Array.isArray(backup.fbGroups), 'fbGroups phải là mảng');
    assert(Array.isArray(backup.zaloGroups), 'zaloGroups phải là mảng');
    console.log(`  ✓ Xuất backup thành công: ${backup.settings.length} settings, ${backup.fbGroups.length} nhóm FB, ${backup.zaloGroups.length} nhóm Zalo`);

    const mockBackupToImport = {
        version: '2.1.0',
        settings: [
            { key: 'test_backup_key', value: 'hello_world' }
        ],
        fbGroups: [
            { name: 'Nhóm Test Import FB', url: 'https://facebook.com/groups/test_import_unique/', member_count: '10K', is_active: 1 }
        ],
        zaloGroups: [
            { name: 'Nhóm Test Import Zalo', is_monitored: 1 }
        ]
    };
    const importStats = await dbAsync.importBackup(mockBackupToImport);
    assert(importStats.importedSettings >= 1, 'Import settings');
    assert(importStats.importedFbGroups >= 1, 'Import FB groups');
    assert(importStats.importedZaloGroups >= 1, 'Import Zalo groups');

    const importedKey = await dbAsync.get(`SELECT value FROM settings WHERE key = 'test_backup_key'`);
    assert.strictEqual(importedKey.value, 'hello_world');
    const importedFb = await dbAsync.get(`SELECT * FROM fb_groups WHERE url = 'https://facebook.com/groups/test_import_unique/'`);
    assert.strictEqual(importedFb.name, 'Nhóm Test Import FB');
    const importedZalo = await dbAsync.get(`SELECT * FROM zalo_groups WHERE name = 'Nhóm Test Import Zalo'`);
    assert.strictEqual(importedZalo.is_monitored, 1);
    console.log('  ✓ Phục hồi dữ liệu từ JSON thành công 100%!');

    // 4. Kiểm thử Zalo Group Whitelist (Chỉ lấy từ các group được bạn chỉ định)
    console.log('\n4. Kiểm thử Bộ lọc Nhóm Zalo Chỉ Định (Zalo Whitelist):');
    // Đảm bảo có nhóm 'Nhóm VIP BĐS' được bật theo dõi
    await dbAsync.run(`INSERT OR IGNORE INTO zalo_groups (name, is_monitored) VALUES ('Nhóm VIP BĐS', 1)`);
    await dbAsync.run(`UPDATE zalo_groups SET is_monitored = 1 WHERE name = 'Nhóm VIP BĐS'`);

    // Gửi tin nhắn từ nhóm được theo dõi
    const initialCount = (await dbAsync.get(`SELECT COUNT(*) as count FROM messages`)).count;
    await processZaloMessage({
        groupName: 'Nhóm VIP BĐS',
        sender: 'Anh Nam',
        text: 'Cần bán gấp nhà hẻm xe hơi giá 2.5 tỷ'
    });

    const afterAllowedCount = (await dbAsync.get(`SELECT COUNT(*) as count FROM messages`)).count;
    assert.strictEqual(afterAllowedCount, initialCount + 1, 'Tin nhắn từ nhóm được theo dõi PHẢI được lưu');
    console.log('  ✓ Tin nhắn từ nhóm được theo dõi [Nhóm VIP BĐS] đã được lưu vào hệ thống!');

    // Gửi tin nhắn từ nhóm KHÔNG được theo dõi
    await processZaloMessage({
        groupName: 'Nhóm Tạp Hóa Không Quan Tâm',
        sender: 'Người lạ',
        text: 'Nội dung spam không liên quan'
    });

    const afterBlockedCount = (await dbAsync.get(`SELECT COUNT(*) as count FROM messages`)).count;
    assert.strictEqual(afterBlockedCount, initialCount + 1, 'Tin nhắn từ nhóm KHÔNG theo dõi PHẢI BỊ BỎ QUA');
    console.log('  ✓ Tin nhắn từ nhóm lạ [Nhóm Tạp Hóa Không Quan Tâm] đã bị BỎ QUA triệt để!');

    console.log('\n========================================================');
    console.log('🎉 TẤT CẢ CÁC BÀI TEST TÍNH NĂNG V2.1 ĐỀU THÀNH CÔNG 100%!');
    console.log('========================================================\n');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ Thất bại:', err);
    process.exit(1);
});
