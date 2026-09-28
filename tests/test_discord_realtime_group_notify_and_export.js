const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    exportPostLinksToFile,
    notifyDiscordGroupStep,
    buildPublishResultEmbed
} = require('../src/services/discordEngine');
const { getDataDir } = require('../src/paths');

async function runTests() {
    console.log('\x1b[34m========================================================\x1b[0m');
    console.log('\x1b[34m🧪 KIỂM THỬ: BÁO CÁO REALTIME TỪNG NHÓM & XUẤT FILE LINK\x1b[0m');
    console.log('\x1b[34m========================================================\n\x1b[0m');

    const testPostId = 9999;
    const testResult = {
        groups: [
            {
                name: 'Nhóm Phòng Trọ Cầu Giấy',
                url: 'https://www.facebook.com/groups/caugiay',
                postUrl: 'https://www.facebook.com/groups/caugiay/posts/111111111',
                status: 'posted'
            },
            {
                name: 'Nhóm Tìm Phòng Trọ Đống Đa',
                url: 'https://www.facebook.com/groups/dongda',
                postUrl: 'https://www.facebook.com/groups/dongda/pending_posts',
                status: 'pending_approval'
            }
        ],
        failed: [
            {
                name: 'Nhóm BĐS Thanh Xuân',
                url: 'https://www.facebook.com/groups/thanhxuan',
                error: 'Tài khoản chưa tham gia nhóm này'
            }
        ]
    };

    // 1. Kiểm thử tạo và định dạng file text tổng hợp link (.txt)
    console.log('1. Kiểm thử exportPostLinksToFile:');
    const exportedPath = await exportPostLinksToFile(testPostId, testResult);
    assert.ok(fs.existsSync(exportedPath), 'File xuất kết quả đăng bài phải tồn tại trên ổ đĩa');
    assert.ok(exportedPath.includes('links_post_9999_'), 'Tên file phải chứa mã bài viết');

    const content = fs.readFileSync(exportedPath, 'utf8');
    console.log('  -> File content preview:\n' + content.split('\r\n').slice(0, 15).join('\n'));

    assert.ok(content.includes('Mã bài viết (Post ID) : #9999'), 'Báo cáo phải ghi đúng Post ID');
    assert.ok(content.includes('Đã đăng công khai : 1 nhóm'), 'Phải đếm đúng 1 nhóm đã đăng trực tiếp');
    assert.ok(content.includes('Chờ QTV phê duyệt : 1 nhóm'), 'Phải đếm đúng 1 nhóm chờ phê duyệt');
    assert.ok(content.includes('Thất bại / Lỗi    : 1 nhóm'), 'Phải đếm đúng 1 nhóm thất bại');
    assert.ok(content.includes('https://www.facebook.com/groups/caugiay/posts/111111111'), 'Phải chứa link bài viết trực tiếp');
    assert.ok(content.includes('https://www.facebook.com/groups/dongda/pending_posts'), 'Phải chứa link bài chờ duyệt');
    assert.ok(content.includes('Tài khoản chưa tham gia nhóm này'), 'Phải chứa lý do lỗi của nhóm thất bại');
    console.log('  ✓ File tổng hợp link tạo thành công với cấu trúc rõ ràng, đầy đủ link công khai & chờ duyệt.');

    // Dọn dẹp file test
    if (fs.existsSync(exportedPath)) {
        fs.unlinkSync(exportedPath);
    }

    // 2. Kiểm thử notifyDiscordGroupStep không ném lỗi khi bot chưa kết nối hoặc chưa cấu hình kênh
    console.log('\n2. Kiểm thử notifyDiscordGroupStep an toàn (fail-safe):');
    await assert.doesNotReject(async () => {
        await notifyDiscordGroupStep({
            postId: testPostId,
            step: 1,
            total: 3,
            groupName: 'Nhóm Test',
            groupUrl: 'https://facebook.com/groups/test',
            status: 'posted',
            postUrl: 'https://facebook.com/groups/test/posts/123'
        });
    }, 'notifyDiscordGroupStep không được gây crash kể cả khi client offline');
    console.log('  ✓ notifyDiscordGroupStep xử lý mượt mà và an toàn.');

    // 3. Kiểm thử buildPublishResultEmbed phân tách trạng thái
    console.log('\n3. Kiểm thử buildPublishResultEmbed phân tách trạng thái:');
    const embed = buildPublishResultEmbed(testPostId, 'Cụm Sinh Viên', testResult.groups, testResult.failed);
    const desc = embed.data.description || '';

    assert.ok(desc.includes('ĐÃ ĐĂNG CÔNG KHAI'), 'Phải có mục hiển thị bài đăng trực tiếp');
    assert.ok(desc.includes('ĐANG CHỜ PHÊ DUYỆT'), 'Phải có mục hiển thị bài chờ duyệt');
    assert.ok(desc.includes('Nhóm đăng thất bại'), 'Phải có mục hiển thị nhóm thất bại');
    assert.ok(desc.includes('caugiay/posts/111111111'), 'Phải chứa link bài đăng');
    assert.ok(desc.includes('dongda/pending_posts'), 'Phải chứa link bài chờ');
    console.log('  ✓ Embed hiển thị rõ ràng từng nhóm: Đã Đăng, Chờ Duyệt, Thất Bại.');

    console.log('\n\x1b[32m✨ TOÀN BỘ CÁC BÀI KIỂM THỬ ĐÃ VƯỢT QUA 100%! ✨\x1b[0m\n');
}

runTests().catch(err => {
    console.error('\x1b[31m❌ Kiểm thử thất bại:\x1b[0m', err);
    process.exit(1);
});
