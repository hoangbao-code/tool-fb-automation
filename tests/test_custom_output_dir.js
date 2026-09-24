const assert = require('assert');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { dbAsync } = require('../src/db');
const { getEffectiveImagesDir, extractImagesFromDiscordZips } = require('../src/services/discordEngine');

async function testCustomOutputDir() {
    console.log('========================================================');
    console.log('🧪 KIỂM THỬ: TÙY CHỌN THƯ MỤC XUẤT ẢNH CỦA BOT DISCORD');
    console.log('========================================================\n');

    const originalSetting = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_image_save_dir'`);
    const customTestDir = path.join(__dirname, 'custom_output_test_' + Date.now());

    try {
        // 1. Kiểm thử thư mục mặc định khi chưa cài đặt
        console.log('1. Kiểm thử thư mục xuất mặc định:');
        await dbAsync.run(`UPDATE settings SET value = '' WHERE key = 'discord_image_save_dir'`);
        const defaultDir = await getEffectiveImagesDir();
        assert.ok(defaultDir.endsWith(path.join('data', 'images')), 'Mặc định phải là data/images');
        assert.ok(fs.existsSync(defaultDir), 'Thư mục mặc định phải tồn tại');
        console.log(`  ✓ Thư mục mặc định chính xác: ${defaultDir}`);

        // 2. Cài đặt thư mục tùy chỉnh
        console.log('\n2. Kiểm thử cấu hình thư mục tùy chỉnh:');
        await dbAsync.run(`UPDATE settings SET value = ? WHERE key = 'discord_image_save_dir'`, [customTestDir]);
        const effectiveDir = await getEffectiveImagesDir();
        assert.strictEqual(path.resolve(effectiveDir), path.resolve(customTestDir), 'Phải trả về đúng thư mục tùy chỉnh');
        assert.ok(fs.existsSync(effectiveDir), 'Hệ thống phải tự động tạo thư mục tùy chỉnh nếu chưa có');
        console.log(`  ✓ Đã nhận diện và tự động tạo thư mục tùy chỉnh: ${effectiveDir}`);

        // 3. Giải nén zip vào thư mục tùy chỉnh
        console.log('\n3. Kiểm thử giải nén file zip vào đúng thư mục tùy chỉnh:');
        const zip = new AdmZip();
        zip.addFile('phong_dep.jpg', Buffer.from('TEST_IMAGE_CONTENT'));
        const zipPath = path.join(customTestDir, 'sample.zip');
        zip.writeZip(zipPath);

        const extracted = await extractImagesFromDiscordZips([{ url: zipPath, name: 'sample.zip' }], 777);
        assert.strictEqual(extracted.length, 1);
        assert.ok(extracted[0].startsWith(customTestDir), `Ảnh phải được lưu trong ${customTestDir}, thực tế: ${extracted[0]}`);
        assert.ok(fs.existsSync(extracted[0]), 'File ảnh giải nén phải tồn tại');
        console.log(`  ✓ Ảnh giải nén đã được lưu chính xác vào thư mục người dùng chọn!`);
        console.log(`  ✓ File: ${extracted[0]}`);

        console.log('\n========================================================');
        console.log('🎉 TẤT CẢ KIỂM THỬ THƯ MỤC TÙY CHỌN ĐÃ VƯỢT QUA 100%!');
        console.log('========================================================');
    } catch (err) {
        console.error('❌ KIỂM THỬ THẤT BẠI:', err);
        process.exit(1);
    } finally {
        // Khôi phục cài đặt gốc
        if (originalSetting?.value !== undefined) {
            await dbAsync.run(`UPDATE settings SET value = ? WHERE key = 'discord_image_save_dir'`, [originalSetting.value]);
        }
        if (fs.existsSync(customTestDir)) {
            fs.rmSync(customTestDir, { recursive: true, force: true });
        }
    }
}

testCustomOutputDir();
