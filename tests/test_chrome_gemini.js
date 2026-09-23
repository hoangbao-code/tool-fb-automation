const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
    findChromeExecutable,
    getChromeUserDataDir,
    isChromeDebuggingActive,
    DEFAULT_PORT
} = require('../src/services/chromeGemini');
const { cleanGeminiOutput, rewriteWithGemini } = require('../src/services/gemini');
const { dbAsync } = require('../src/db');

async function runTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU TEST: TÍCH HỢP GOOGLE CHROME GEMINI (CDP)');
    console.log('========================================================\n');

    // 1. Kiểm tra tìm kiếm thực thi Chrome
    console.log('1. Kiểm tra tìm file thực thi Google Chrome trên máy:');
    const chromePath = findChromeExecutable();
    assert.ok(chromePath, 'Không tìm thấy Google Chrome');
    assert.ok(fs.existsSync(chromePath), `File Chrome không tồn tại tại: ${chromePath}`);
    console.log(`  ✓ Đã phát hiện chính xác Chrome tại: ${chromePath}`);

    // 2. Kiểm tra thư mục Profile riêng biệt
    console.log('\n2. Kiểm tra thư mục Profile riêng biệt cho Chrome Gemini:');
    const profileDir = getChromeUserDataDir();
    assert.ok(profileDir, 'Profile directory rỗng');
    assert.ok(fs.existsSync(profileDir), `Thư mục profile không tồn tại: ${profileDir}`);
    console.log(`  ✓ Profile Directory an toàn: ${profileDir}`);

    // 3. Kiểm tra kiểm tra cổng Remote Debugging (khi chưa bật)
    console.log('\n3. Kiểm tra trạng thái cổng Remote Debugging:');
    const status = await isChromeDebuggingActive(DEFAULT_PORT);
    assert.strictEqual(typeof status.active, 'boolean');
    console.log(`  ✓ Trạng thái Chrome Debugging cổng ${DEFAULT_PORT}: ${status.active ? 'ĐANG CHẠY' : 'CHƯA BẬT'}`);

    // 4. Kiểm tra làm sạch văn bản phản hồi từ Gemini
    console.log('\n4. Kiểm tra làm sạch văn bản phản hồi từ Gemini Web (cleanGeminiOutput):');
    const rawAiWeb = 'Chào bạn! Dưới đây là bài đăng Facebook hoàn chỉnh cho bạn:\n\n🔥 CẦN BÁN GẤP NHÀ PHỐ 3 TẦNG Q7!\nGiá: 5.2 tỷ có thương lượng.\n\nChúc bạn một ngày tốt lành và bán được nhà nhanh chóng!';
    const cleaned = cleanGeminiOutput(rawAiWeb);
    assert.ok(!cleaned.includes('Chào bạn! Dưới đây là'), 'Chưa lọc sạch câu mở đầu');
    assert.ok(!cleaned.includes('Chúc bạn một ngày tốt lành'), 'Chưa lọc sạch câu kết thúc');
    assert.ok(cleaned.includes('🔥 CẦN BÁN GẤP NHÀ PHỐ 3 TẦNG Q7!'), 'Nội dung cốt lõi bị mất');
    console.log('  ✓ cleanGeminiOutput gọt bỏ hoàn toàn câu chào mở đầu và kết thúc!');

    // 5. Kiểm tra thông báo hướng dẫn khi chưa kết nối Chrome & chưa có API Key
    console.log('\n5. Kiểm tra thông báo hướng dẫn khi chưa kết nối:');
    // Tạm xóa API key để test error message
    const savedKey = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
    await dbAsync.run(`UPDATE settings SET value = '' WHERE key = 'gemini_api_key'`);

    try {
        await rewriteWithGemini('Tin BĐS test', 'Người gửi', 'Nhóm Test');
        if (!status.active) {
            assert.fail('Cần phải ném lỗi khi không có Chrome và không có API key');
        }
    } catch (err) {
        if (!status.active) {
            assert.ok(err.message.includes('Mở Google Chrome Gemini') || err.message.includes('Google Chrome'), 'Thông báo lỗi phải hướng dẫn mở Google Chrome Gemini');
            console.log(`  ✓ Hệ thống thông báo rõ ràng: "${err.message}"`);
        }
    } finally {
        // Phục hồi lại key ban đầu nếu có
        if (savedKey?.value) {
            await dbAsync.run(`UPDATE settings SET value = ? WHERE key = 'gemini_api_key'`, [savedKey.value]);
        }
    }

    // 6. Kiểm tra cài đặt Cuộc trò chuyện đã ghim & Chế độ gửi nội dung thô
    console.log('\n6. Kiểm tra cấu hình Cuộc trò chuyện đã ghim & Gửi nội dung thô:');
    const { getActiveGeminiTabInfo } = require('../src/services/chromeGemini');
    assert.strictEqual(typeof getActiveGeminiTabInfo, 'function');

    // Thử lưu và đọc settings
    const testUrl = 'https://gemini.google.com/app/1a2b3c4d5e';
    await dbAsync.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_conversation_url', ?)`, [testUrl]);
    await dbAsync.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_send_raw_content', '1')`);

    const readUrl = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_conversation_url'`);
    const readRaw = await dbAsync.get(`SELECT value FROM settings WHERE key = 'gemini_send_raw_content'`);

    assert.strictEqual(readUrl.value, testUrl);
    assert.strictEqual(readRaw.value, '1');
    console.log(`  ✓ Cấu hình Cuộc trò chuyện đã ghim (${readUrl.value}) lưu & đọc chính xác 100%!`);
    console.log(`  ✓ Chế độ "Chỉ gửi nội dung thô" (${readRaw.value}) kích hoạt thành công!`);

    console.log('\n========================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ CHROME GEMINI ĐÃ ĐẠT 100%!');
    console.log('========================================================\n');
}

runTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('❌ Kiểm thử thất bại:', err);
    process.exit(1);
});
