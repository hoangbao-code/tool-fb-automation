const assert = require('assert');
const { dbAsync } = require('../src/db');
const { isValidHistoricalPost, processHistoricalZaloMessages } = require('../src/services/historyScanner');

async function runHistoryScannerTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ TÍNH NĂNG QUÉT LỊCH SỬ TIN NHẮN (7 NGÀY)');
    console.log('========================================================\n');

    // 1. Kiểm thử bộ lọc tin chất lượng isValidHistoricalPost
    console.log('1. Kiểm thử bộ lọc tin chất lượng & loại trừ tin rác (isValidHistoricalPost):');

    assert.strictEqual(isValidHistoricalPost('ok'), false, 'Từ "ok" phải bị loại bỏ');
    assert.strictEqual(isValidHistoricalPost('dạ anh'), false, 'Tin chào ngắn phải bị loại bỏ');
    assert.strictEqual(isValidHistoricalPost('alo alo?'), false, 'Tin gọi ngắn phải bị loại bỏ');
    assert.strictEqual(isValidHistoricalPost('hello cả nhà'), false, 'Tin chào phải bị loại bỏ');
    assert.strictEqual(isValidHistoricalPost('đã gửi một nhãn dán'), false, 'Thông báo nhãn dán phải bị loại bỏ');
    assert.strictEqual(isValidHistoricalPost(''), false, 'Chuỗi rỗng phải bị loại bỏ');
    assert.strictEqual(isValidHistoricalPost(null), false, 'Null phải bị loại bỏ');
    console.log('  ✓ Lọc thành công tin rác, chào hỏi, nhãn dán ngắn');

    const realEstatePost = 'Chính chủ cần bán gấp căn hộ 2PN 70m2 tại Vinhomes Central Park giá 4.2 tỷ, LH: 0901234567';
    assert.strictEqual(isValidHistoricalPost(realEstatePost), true, 'Bài viết bất động sản hợp lệ phải được chấp nhận');

    const chdvPost = 'Studio ban công full nội thất 35m2 giá 6.5tr cọc 1th lh 0938112233';
    assert.strictEqual(isValidHistoricalPost(chdvPost), true, 'Bài viết CHDV phòng trọ hợp lệ phải được chấp nhận');

    const hiringPost = 'Tuyển dụng nhân viên kinh doanh online lương cứng 10 triệu + hoa hồng cao, liên hệ ngay.';
    assert.strictEqual(isValidHistoricalPost(hiringPost), true, 'Bài viết tuyển dụng hợp lệ phải được chấp nhận');
    console.log('  ✓ Nhận diện chính xác bài đăng giá trị (Bất động sản, CHDV, phòng trọ, tuyển dụng, buôn bán)');

    // 1.1 Kiểm thử chuẩn hóa tên nhóm normalizeName
    const { normalizeName } = require('../src/services/historyScanner');
    assert.strictEqual(normalizeName('UNICORN\u00A0TEAM'), 'unicorn team', 'Phải chuẩn hóa non-breaking space \\u00A0');
    assert.strictEqual(normalizeName('Sale phòng (150 thành viên)'), 'sale phòng', 'Phải loại bỏ số thành viên trong ngoặc');
    console.log('  ✓ Chuẩn hóa tên nhóm thành công (xóa \\u00A0 và số thành viên)');

    // 2. Thiết lập môi trường test trong DB
    console.log('\n2. Kiểm thử nạp lịch sử & Khử trùng lặp (processHistoricalZaloMessages):');

    const testGroupName = 'Nhóm Test BĐS 7 Ngày ' + Date.now();
    await dbAsync.run(`INSERT INTO zalo_groups (name, is_monitored) VALUES (?, 1)`, [testGroupName]);

    const testMessages = [
        {
            groupName: testGroupName,
            sender: 'Nguyễn Văn A',
            text: 'Bán nhà hẻm xe hơi Phan Văn Trị Gò Vấp 60m2 giá 5.5 tỷ thương lượng LH 0988776655',
            images: []
        },
        {
            groupName: testGroupName,
            sender: 'Trần B',
            text: 'ok em', // Tin rác -> Bỏ qua
            images: []
        },
        {
            groupName: testGroupName,
            sender: 'Lê C',
            text: 'Cần cho thuê mặt bằng kinh doanh quận 1 diện tích 120m2 giá 35 triệu/tháng sđt 0911223344',
            images: []
        }
    ];

    // Lần quét 1: Nạp 2 tin hợp lệ, bỏ qua 1 tin rác
    const result1 = await processHistoricalZaloMessages(testMessages, { limit: 10 });
    assert.strictEqual(result1.success, true);
    assert.strictEqual(result1.queued, 2, 'Phải nạp đúng 2 bài viết chất lượng');
    assert.strictEqual(result1.skipped, 1, 'Phải bỏ qua 1 tin rác ngắn');
    console.log(`  ✓ Lần 1: Nạp thành công ${result1.queued} bài, bỏ qua ${result1.skipped} tin rác`);

    // Lần quét 2: Chạy lại với cùng danh sách tin -> Phải khử trùng lặp 100%
    const result2 = await processHistoricalZaloMessages(testMessages, { limit: 10 });
    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.queued, 0, 'Không được nạp trùng bài cũ đã có trong DB');
    assert.strictEqual(result2.skipped, 3, 'Cả 3 tin đều phải bị bỏ qua (2 trùng lặp, 1 rác)');
    console.log(`  ✓ Lần 2 (Khử trùng lặp): Nạp ${result2.queued} bài mới, bỏ qua ${result2.skipped} bài trùng lặp (CHÍNH XÁC)`);

    // 3. Kiểm tra bài viết đã vào bảng posts
    const insertedPosts = await dbAsync.all(
        `SELECT * FROM posts WHERE group_name = ?`,
        [testGroupName]
    );
    assert.strictEqual(insertedPosts.length, 2, 'Bảng posts phải chứa đúng 2 bài viết từ nhóm test');
    for (const p of insertedPosts) {
        assert(p.rewritten_text.length > 0, 'Bài viết phải có rewritten_text');
        assert(['pending', 'approved'].includes(p.status), 'Trạng thái bài phải là pending hoặc approved');
    }
    console.log(`  ✓ Dữ liệu trong bảng posts hoàn toàn hợp lệ (#${insertedPosts.map(p => p.id).join(', #')})`);

    // Dọn dẹp dữ liệu test
    await dbAsync.run(`DELETE FROM posts WHERE group_name = ?`, [testGroupName]);
    await dbAsync.run(`DELETE FROM messages WHERE group_name = ?`, [testGroupName]);
    await dbAsync.run(`DELETE FROM zalo_groups WHERE name = ?`, [testGroupName]);
    await dbAsync.run(`DELETE FROM logs WHERE message LIKE ?`, [`%${testGroupName}%`]);

    console.log('\n========================================================');
    console.log('✅ TẤT CẢ TEST QUÉT LỊCH SỬ TIN NHẮN (7 NGÀY) ĐÃ VƯỢT QUA 100%!');
    console.log('========================================================\n');
}

runHistoryScannerTests().catch(err => {
    console.error('❌ LỖI TEST:', err);
    process.exit(1);
});
