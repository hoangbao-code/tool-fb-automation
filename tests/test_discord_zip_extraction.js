const assert = require('assert');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { dbAsync } = require('../src/db');
const { 
    extractMediaAttachments, 
    extractImagesFromDiscordZips, 
    processDiscordBuffer 
} = require('../src/services/discordEngine');

async function runZipExtractionTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ: TỰ ĐỘNG GIẢI NÉN FILE ZIP TRÊN DISCORD');
    console.log('========================================================\n');

    const tempDir = path.join(__dirname, 'temp_zip_test');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
        // 1. Kiểm thử phân loại Attachment (Ảnh vs File Zip vs File Khác)
        console.log('1. Kiểm thử nhận diện và phân loại đính kèm từ Discord:');
        const fakeMessage = {
            attachments: new Map([
                ['att1', { name: 'photo1.jpg', contentType: 'image/jpeg', url: 'https://cdn.discordapp.com/1/photo1.jpg' }],
                ['att2', { name: 'photos_phongtro.zip', contentType: 'application/zip', url: 'https://cdn.discordapp.com/1/photos_phongtro.zip' }],
                ['att3', { name: 'hopdong.pdf', contentType: 'application/pdf', url: 'https://cdn.discordapp.com/1/hopdong.pdf' }],
                ['att4', { name: 'archive_canho.ZIP', contentType: 'application/x-zip-compressed', url: 'https://cdn.discordapp.com/1/archive_canho.ZIP' }],
                ['att5', { name: 'view_bancong.webp', contentType: 'image/webp', url: 'https://cdn.discordapp.com/1/view_bancong.webp' }],
                ['att6', { name: 'notes.txt', contentType: 'text/plain', url: 'https://cdn.discordapp.com/1/notes.txt' }]
            ])
        };

        const { images, zips } = extractMediaAttachments(fakeMessage);
        assert.strictEqual(images.length, 2, 'Phải trích xuất được 2 file ảnh trực tiếp');
        assert.strictEqual(zips.length, 2, 'Phải trích xuất được 2 file zip');
        assert.strictEqual(zips[0].name, 'photos_phongtro.zip');
        assert.strictEqual(zips[1].name, 'archive_canho.ZIP');
        console.log(`  ✓ Nhận diện chính xác 2 ảnh và 2 file zip, loại bỏ an toàn file PDF và TXT.`);

        // 2. Tạo file ZIP mẫu chứa ảnh phòng trọ và cấu trúc thư mục lồng nhau
        console.log('\n2. Tạo file ZIP thử nghiệm chứa nhiều ảnh phòng & cấu trúc thư mục con:');
        const testZip = new AdmZip();

        // Thêm các ảnh vào root và subfolder
        testZip.addFile('phong_khach.jpg', Buffer.from('FAKE_JPG_DATA_1'));
        testZip.addFile('nha_bep.png', Buffer.from('FAKE_PNG_DATA_2'));
        testZip.addFile('tang_2/phong_ngu.jpeg', Buffer.from('FAKE_JPEG_DATA_3'));
        testZip.addFile('tang_2/ban_cong.webp', Buffer.from('FAKE_WEBP_DATA_4'));
        // Thêm file không phải ảnh
        testZip.addFile('bang_gia.xlsx', Buffer.from('FAKE_EXCEL_DATA'));
        testZip.addFile('tang_2/huong_dan.txt', Buffer.from('FAKE_TEXT_DATA'));
        // Thêm rác hệ điều hành macOS
        testZip.addFile('__MACOSX/._phong_khach.jpg', Buffer.from('MACOS_METADATA'));
        testZip.addFile('.DS_Store', Buffer.from('DS_STORE_DATA'));

        const zipFilePath = path.join(tempDir, 'test_apartment_images.zip');
        testZip.writeZip(zipFilePath);
        assert.ok(fs.existsSync(zipFilePath), 'File zip thử nghiệm phải được tạo');
        console.log(`  ✓ Đã đóng gói file zip thử nghiệm với 4 ảnh + file rác macOS.`);

        // 3. Kiểm thử giải nén và trích xuất ảnh tự động
        console.log('\n3. Kiểm thử tự động giải nén và lưu ảnh vào data/images/:');
        const testPostId = 999111;
        const extractedPaths = await extractImagesFromDiscordZips(
            [{ url: zipFilePath, name: 'test_apartment_images.zip' }],
            testPostId
        );

        assert.strictEqual(extractedPaths.length, 4, 'Phải giải nén chính xác 4 ảnh (bỏ qua file excel, txt và rác macOS)');
        
        for (const imgPath of extractedPaths) {
            assert.ok(fs.existsSync(imgPath), `File ảnh ${imgPath} phải thực sự tồn tại trên ổ đĩa`);
            const stat = fs.statSync(imgPath);
            assert.ok(stat.size > 0, `File ảnh ${imgPath} không được rỗng`);
        }
        console.log(`  ✓ Đã giải nén và lưu ${extractedPaths.length} file ảnh thật vào thư mục data/images/.`);
        console.log(`  ✓ Đường dẫn mẫu: ${extractedPaths[0]}`);

        // 4. Kiểm thử lưu bài viết với ảnh từ zip vào SQLite
        console.log('\n4. Kiểm thử lưu trữ bài viết có ảnh giải nén vào SQLite:');
        const insertRes = await dbAsync.run(
            `INSERT INTO posts (rewritten_text, status, images) VALUES (?, 'pending', ?)`,
            ['Căn hộ mini ban công thoáng mát giải nén từ zip', JSON.stringify(extractedPaths)]
        );
        const savedPostId = insertRes.id;
        const fetchedPost = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [savedPostId]);
        assert.ok(fetchedPost, 'Bài viết phải lưu thành công');
        const parsedImages = JSON.parse(fetchedPost.images);
        assert.strictEqual(parsedImages.length, 4);
        console.log(`  ✓ Bài viết #${savedPostId} lưu trữ danh sách ảnh giải nén trong DB chính xác 100%.`);

        // Dọn dẹp
        await dbAsync.run(`DELETE FROM posts WHERE id = ?`, [savedPostId]);
        for (const p of extractedPaths) {
            if (fs.existsSync(p)) fs.unlinkSync(p);
        }

        console.log('\n========================================================');
        console.log('🎉 TẤT CẢ KIỂM THỬ GIẢI NÉN FILE ZIP ĐÃ VƯỢT QUA 100%!');
        console.log('========================================================');
    } catch (err) {
        console.error('❌ KIỂM THỬ THẤT BẠI:', err);
        process.exit(1);
    } finally {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }
}

runZipExtractionTests();
