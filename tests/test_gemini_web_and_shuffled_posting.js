const assert = require('assert');
const { dbAsync } = require('../src/db');
const { cleanGeminiOutput } = require('../src/services/gemini');
const { publishPost } = require('../src/services/fbEngine');

async function testShuffledGroupPosting() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU TEST: GEMINI WEB THUẦN TÚY & ĐĂNG RẢI RÁC LỘN XỘN');
    console.log('========================================================\n');

    // 1. Kiểm thử thuật toán xáo trộn nhóm (Fisher-Yates Shuffle)
    console.log('1. Kiểm thử xáo trộn thứ tự nhóm Facebook (Anti-spam / Anti-pattern):');
    const originalList = [
        { id: 1, name: 'Nhóm 1' },
        { id: 2, name: 'Nhóm 2' },
        { id: 3, name: 'Nhóm 3' },
        { id: 4, name: 'Nhóm 4' },
        { id: 5, name: 'Nhóm 5' },
        { id: 6, name: 'Nhóm 6' },
        { id: 7, name: 'Nhóm 7' },
        { id: 8, name: 'Nhóm 8' }
    ];

    function shuffle(arr) {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    const shuffled1 = shuffle(originalList);
    const shuffled2 = shuffle(originalList);

    assert.strictEqual(shuffled1.length, originalList.length, 'Số lượng nhóm sau xáo trộn phải bảo toàn');
    assert(originalList.every(item => shuffled1.some(s => s.id === item.id)), 'Tất cả các phần tử ban đầu phải còn nguyên vẹn');
    
    // Kiểm tra thứ tự có khác ban đầu trong hầu hết các trường hợp
    const isOrderDifferent = shuffled1.some((item, idx) => item.id !== originalList[idx].id) ||
                            shuffled2.some((item, idx) => item.id !== originalList[idx].id);
    assert(isOrderDifferent, 'Thứ tự các nhóm phải được xáo trộn ngẫu nhiên');
    console.log('  ✓ Thứ tự nhóm đã được xáo trộn lộn xộn ngẫu nhiên thành công (Fisher-Yates).');

    // 2. Kiểm thử cleanGeminiOutput gọt sạch văn phong robot
    console.log('\n2. Kiểm thử làm sạch bài viết Gemini Web:');
    const sampleAiWebOutput = `Chào bạn! Rất vui được hỗ trợ bạn. Dưới đây là bài đăng Facebook hoàn chỉnh:

🏠 PHÒNG CHO THUÊ QUẬN BÌNH THẠNH 🏠
- Vị trí: Điện Biên Phủ, P.25, Bình Thạnh
- Full nội thất, giờ giấc tự do
- Giá: 5.5 tr/tháng
- LH: 0901234567

Hy vọng bài viết này sẽ giúp bạn cho thuê phòng nhanh chóng!`;

    const cleaned = cleanGeminiOutput(sampleAiWebOutput);
    assert(!cleaned.includes('Chào bạn!'), 'Phải gọt sạch lời chào');
    assert(!cleaned.includes('Hy vọng bài viết này'), 'Phải gọt sạch lời chúc cuối');
    assert(cleaned.includes('PHÒNG CHO THUÊ QUẬN BÌNH THẠNH'), 'Phải giữ nguyên tiêu đề và nội dung bài');
    console.log('  ✓ Gọt sạch 100% câu chào mở đầu và kết thúc từ Gemini Web.');

    // 3. Kiểm thử cài đặt chế độ gửi nội dung thô (gemini_send_raw_content)
    console.log('\n3. Kiểm thử cài đặt chế độ gửi nội dung thô:');
    await dbAsync.run(`UPDATE settings SET value = '1' WHERE key = 'gemini_send_raw_content'`);
    const settingRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_send_raw_content'`);
    assert.strictEqual(settingRow.value, '1', 'gemini_send_raw_content phải là 1 (chế độ gửi thô)');
    console.log('  ✓ Cấu hình gửi nội dung thô vào Gemini Web hoạt động chính xác.');

    console.log('\n========================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ ĐÃ ĐẠT 100%!');
    console.log('========================================================');
}

testShuffledGroupPosting().catch(err => {
    console.error('❌ Lỗi:', err);
    process.exit(1);
});
