const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

console.log('========================================================');
console.log('🧪 KIỂM THỬ CÚ PHÁP THỰC THI FB_DOM_POST_SCRIPT');
console.log('========================================================\n');

const code = fs.readFileSync('src/services/fbPoster.js', 'utf8');
const start = code.indexOf('const FB_DOM_POST_SCRIPT');
const end = code.indexOf('async function postViaWebview');
const scriptDef = code.substring(start, end).replace('const FB_DOM_POST_SCRIPT', 'global.FB_DOM_POST_SCRIPT');
eval(scriptDef);

assert.strictEqual(typeof global.FB_DOM_POST_SCRIPT, 'function', 'FB_DOM_POST_SCRIPT phải là function');

const testCases = [
    'Nội dung ngắn đơn giản',
    'Nhiều dòng\r\nDòng 2: Giá 10 triệu/tháng\r\nDòng 3: Liên hệ 0901234567',
    'Có dấu ngoặc kép "test" và nháy đơn \'test\'',
    'Có ký tự backtick `code` và template literal ${variable}',
    'Có emoji: 🇻🇳 🇬🇧 🏢 🏠 🚀 🔥 ✨ và hashtag #apartment #rent #saigon',
    'Nội dung có ký tự đặc biệt: <script>alert(1)</script> & " \' / \\ \n \r \t',
    ''
];

for (let i = 0; i < testCases.length; i++) {
    const text = testCases[i];
    const rendered = global.FB_DOM_POST_SCRIPT(text, [
        { name: 'test.jpg', mime: 'image/jpeg', base64: 'abc123xyz' }
    ]);
    try {
        new vm.Script(rendered);
        console.log(`  ✓ Test case #${i + 1} cú pháp JavaScript hợp lệ 100%!`);
    } catch (e) {
        console.error(`  ❌ Test case #${i + 1} BỊ LỖI CÚ PHÁP:`, e.message);
        throw e;
    }
}

console.log('\n🎉 TOÀN BỘ CÚ PHÁP FB_DOM_POST_SCRIPT ĐÃ ĐẠT 100% HOÀN HẢO!\n');
