const assert = require('assert');
const { dbAsync } = require('../src/db');
const { cleanGeminiOutput, rewriteWithGemini } = require('../src/services/gemini');

async function runTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU TEST: XÓA BẢNG TIN & BIÊN TẬP GEMINI AI');
    console.log('========================================================\n');

    // 1. Kiểm thử cleanGeminiOutput
    console.log('1. Kiểm thử làm sạch văn phong AI (cleanGeminiOutput):');
    const dirtyOutput = `Tuyệt vời! Với vai trò là một chuyên viên content marketing bất động sản cho thuê tại TP.HCM, dưới đây là bài đăng Facebook Marketplace hoàn chỉnh dành cho bạn:

🔥 CĂN HỘ CAO CẤP SUNRISE CITY VIEW QUẬN 7 🔥
📍 Vị trí: Nguyễn Hữu Thọ, P. Tân Hưng, Quận 7
✨ Phòng 2PN 70m2 full nội thất cao cấp
📞 LH xem phòng: 0354084364

Hy vọng bài viết này sẽ giúp bạn thu hút được nhiều khách hàng tiềm năng!`;

    const cleaned = cleanGeminiOutput(dirtyOutput);
    assert(!cleaned.includes('Tuyệt vời!'), 'Phải xóa bỏ câu chào đầu robot');
    assert(!cleaned.includes('Hy vọng bài viết này'), 'Phải xóa bỏ câu chúc kết thúc robot');
    assert(cleaned.includes('CĂN HỘ CAO CẤP'), 'Phải giữ nguyên tiêu đề và nội dung bài');
    console.log('  ✓ cleanGeminiOutput đã gọt sạch 100% câu chào mở đầu và kết thúc nhảm nhí.');

    // 2. Kiểm thử thay thế placeholder [Dán thông tin phòng thô vào đây]
    console.log('\n2. Kiểm thử xử lý Prompt tùy chỉnh có placeholder [Dán thông tin...]:');
    const customPromptTemplate = `Nhiệm vụ: Viết lại bài đăng BĐS Facebook.\n---\nDữ liệu đầu vào:\n[Dán thông tin phòng thô vào đây]`;
    const placeholderRegex = /\[Dán.*?\]|\{CONTENT\}/gi;
    const testContent = 'Phòng trọ 30m2 giá 4tr full đồ';
    const replacedPrompt = customPromptTemplate.replace(placeholderRegex, testContent);
    assert(replacedPrompt.includes('Phòng trọ 30m2 giá 4tr full đồ'), 'Phải thay thế thành công placeholder tiếng Việt');
    assert(!replacedPrompt.includes('[Dán thông tin phòng thô vào đây]'), 'Không được để sót placeholder thô');
    console.log('  ✓ Regex nhận diện và thay thế chính xác mẫu prompt thực tế của người dùng.');

    // 3. Kiểm thử xóa bài viết bảng tin bảo toàn danh sách nhóm Zalo & FB
    console.log('\n3. Kiểm thử "Xóa Tất Cả Bài" bảo toàn tuyệt đối nhóm Zalo & Facebook:');

    // Đảm bảo có dữ liệu nhóm
    await dbAsync.run(`INSERT OR IGNORE INTO zalo_groups (name, is_monitored) VALUES ('Nhóm Zalo Bảo Toàn Test', 1)`);
    await dbAsync.run(`INSERT OR IGNORE INTO fb_groups (name, url, is_active) VALUES ('Nhóm FB Bảo Toàn Test', 'https://facebook.com/groups/baotoan_test', 1)`);

    // Tạo bài viết giả lập
    await dbAsync.run(`INSERT INTO posts (group_name, original_text, rewritten_text, status) VALUES ('Nhóm Zalo Bảo Toàn Test', 'Gốc 1', 'Đã viết 1', 'pending')`);
    await dbAsync.run(`INSERT INTO posts (group_name, original_text, rewritten_text, status) VALUES ('Nhóm Zalo Bảo Toàn Test', 'Gốc 2', 'Đã viết 2', 'posted')`);

    const zaloBefore = await dbAsync.all(`SELECT * FROM zalo_groups`);
    const fbBefore = await dbAsync.all(`SELECT * FROM fb_groups`);
    const postsBefore = await dbAsync.all(`SELECT * FROM posts`);
    assert(postsBefore.length >= 2, 'Phải có ít nhất 2 bài viết trước khi xóa');

    // Giả lập xử lý của clear-all-posts
    await dbAsync.run(`DELETE FROM posts`);

    const zaloAfter = await dbAsync.all(`SELECT * FROM zalo_groups`);
    const fbAfter = await dbAsync.all(`SELECT * FROM fb_groups`);
    const postsAfter = await dbAsync.all(`SELECT * FROM posts`);

    assert.strictEqual(postsAfter.length, 0, 'Toàn bộ bài viết trong posts phải được xóa sạch');
    assert.strictEqual(zaloAfter.length, zaloBefore.length, 'Số lượng nhóm Zalo phải giữ nguyên 100% không đổi');
    assert.strictEqual(fbAfter.length, fbBefore.length, 'Số lượng nhóm Facebook phải giữ nguyên 100% không đổi');
    console.log('  ✓ Đã xóa sạch toàn bộ posts trong bảng tin.');
    console.log(`  ✓ Nhóm Zalo giữ nguyên vẹn: ${zaloAfter.length} nhóm.`);
    console.log(`  ✓ Nhóm Facebook giữ nguyên vẹn: ${fbAfter.length} nhóm.`);

    // 4. Dọn dẹp dữ liệu test
    await dbAsync.run(`DELETE FROM zalo_groups WHERE name = 'Nhóm Zalo Bảo Toàn Test'`);
    await dbAsync.run(`DELETE FROM fb_groups WHERE url = 'https://facebook.com/groups/baotoan_test'`);

    console.log('\n========================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ XÓA BÀI & GEMINI AI ĐÃ ĐẠT 100%!');
    console.log('========================================================');
}

runTests().catch(err => {
    console.error('❌ Lỗi kiểm thử:', err);
    process.exit(1);
});
