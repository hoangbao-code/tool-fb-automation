const assert = require('assert');
const { rewriteWithGemini, spinPostForGroup, isEnglishPost } = require('../src/services/gemini');

console.log('========================================================');
console.log('🧪 BẮT ĐẦU KIỂM THỬ: TÍNH NĂNG CHỌN NGÔN NGỮ AI (VI/EN)');
console.log('========================================================\n');

// 1. Test isEnglishPost detection
console.log('1. Kiểm tra nhận diện bài viết / nhóm tiếng Anh (isEnglishPost)...');
const enPost = 'Apartment for rent in District 1, Ho Chi Minh City. Price: $800/month. Full furnished.';
const viPost = 'Cho thuê căn hộ cao cấp tại Quận 1, TP.HCM. Giá 18 triệu/tháng. Đầy đủ nội thất.';

assert.strictEqual(isEnglishPost(enPost, 'Apartments in Saigon'), true, 'Phải nhận diện là tiếng Anh khi nội dung có apartment/rent');
assert.strictEqual(isEnglishPost(viPost, 'Hội Căn Hộ Sài Gòn'), false, 'Phải nhận diện là tiếng Việt khi nội dung thuần Việt');
assert.strictEqual(isEnglishPost(viPost, 'Expats in Vietnam'), true, 'Phải nhận diện là tiếng Anh khi nhóm là nhóm Expat');
console.log('  ✓ Nhận diện ngôn ngữ chuẩn xác 100%!\n');

// 2. Test spinPostForGroup with English vs Vietnamese
console.log('2. Kiểm tra spin bài viết theo ngôn ngữ (spinPostForGroup)...');
const spunEn = spinPostForGroup(enPost, 'Expats Saigon', 1);
const spunVi = spinPostForGroup(viPost, 'Hội Căn Hộ Sài Gòn', 1);

// English post should have English Hook and CTA
assert.ok(
    spunEn.includes('HOT LISTING') || spunEn.includes('NEW UPDATE') || spunEn.includes('AVAILABLE') || spunEn.includes('PROPERTY'),
    'Bài tiếng Anh phải có Hook tiếng Anh'
);
assert.ok(
    spunEn.toLowerCase().includes('viewing') || spunEn.toLowerCase().includes('contact') || spunEn.toLowerCase().includes('inbox') || spunEn.toLowerCase().includes('message'),
    'Bài tiếng Anh phải có CTA tiếng Anh'
);
assert.ok(
    !spunEn.includes('quan tâm') && !spunEn.includes('liên hệ'),
    'Bài tiếng Anh không được lẫn CTA tiếng Việt'
);

// Vietnamese post should have Vietnamese Hook and CTA
assert.ok(
    spunVi.includes('TIN HOT') || spunVi.includes('CẬP NHẬT') || spunVi.includes('DÀNH CHO') || spunVi.includes('SIÊU PHẨM'),
    'Bài tiếng Việt phải có Hook tiếng Việt'
);
assert.ok(
    spunVi.includes('liên hệ') || spunVi.includes('inbox') || spunVi.includes('nhắn tin') || spunVi.includes('quan tâm'),
    'Bài tiếng Việt phải có CTA tiếng Việt'
);
console.log('  ✓ Spin nội dung thông minh tự chuyển Hook/CTA theo ngôn ngữ chuẩn xác!\n');

console.log('✨ TOÀN BỘ KIỂM THỬ NGÔN NGỮ AI ĐÃ VƯỢT QUA 100%! ✨\n');
