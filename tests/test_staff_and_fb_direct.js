const assert = require('assert');
const path = require('path');
const http = require('http');

// Thiết lập môi trường test
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';

const { dbAsync } = require('../src/db');
const { createServer } = require('../src/server');
const { loginUserWithCredentials, scanUserFbGroups } = require('../src/services/multiFbEngine');

async function runTests() {
    console.log('--- BẮT ĐẦU KIỂM THỬ: QUẢN LÝ NHÂN VIÊN & ĐĂNG NHẬP / QUÉT NHÓM FACEBOOK ---');

    // 1. Kiểm thử DB User Operations
    console.log('\n[Test 1] Kiểm thử DB: Cấp tài khoản, đổi mật khẩu và bảo vệ Admin ID: 1');
    const testUsername = `nv_test_${Date.now()}`;
    const createdUser = await dbAsync.createUser({
        username: testUsername,
        password: 'password123',
        displayName: 'Nhân Viên Test 1',
        discordChannelId: '9988776655',
        role: 'staff'
    });

    assert(createdUser.id > 1, 'ID nhân viên mới phải > 1');
    assert.strictEqual(createdUser.username, testUsername);
    assert.strictEqual(createdUser.display_name, 'Nhân Viên Test 1');
    assert.strictEqual(createdUser.discord_channel_id, '9988776655');

    // Kiểm tra trùng username phải báo lỗi
    let duplicateErrorThrown = false;
    try {
        await dbAsync.createUser({ username: testUsername, password: '123' });
    } catch (e) {
        duplicateErrorThrown = true;
    }
    assert(duplicateErrorThrown, 'Phải chặn việc tạo trùng username');

    // Cập nhật mật khẩu và thông tin
    await dbAsync.updateUser(createdUser.id, {
        password: 'new_password_456',
        display_name: 'Nhân Viên Đã Đổi Tên'
    });
    const updatedUser = await dbAsync.getUserById(createdUser.id);
    assert.strictEqual(updatedUser.display_name, 'Nhân Viên Đã Đổi Tên');

    // Không được phép xóa Admin (id: 1)
    let adminDeleteBlocked = false;
    try {
        await dbAsync.deleteUser(1);
    } catch (e) {
        adminDeleteBlocked = true;
    }
    assert(adminDeleteBlocked, 'Phải ngăn chặn việc xóa Quản trị viên chính (Admin ID: 1)');

    // Xóa nhân viên test
    await dbAsync.deleteUser(createdUser.id);
    const checkDeleted = await dbAsync.getUserById(createdUser.id);
    assert.strictEqual(checkDeleted, undefined, 'Nhân viên đã xóa không được xuất hiện trong DB');
    console.log('✓ Test 1 ĐẠT: CRUD Nhân viên và cơ chế bảo vệ Admin hoạt động hoàn hảo.');

    // 2. Khởi chạy Web Server để kiểm thử các API endpoints
    console.log('\n[Test 2] Kiểm thử Server API: CRUD Nhân viên qua REST API');
    const app = createServer();
    const server = http.createServer(app);
    await new Promise(r => server.listen(3099, r));

    function makeRequest(options, postData = null) {
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: 3099,
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) });
                    } catch (e) {
                        resolve({ status: res.statusCode, body: data });
                    }
                });
            });
            req.on('error', reject);
            if (postData) req.write(JSON.stringify(postData));
            req.end();
        });
    }

    // 2.1 Tạo nhân viên qua API POST /api/users
    const apiUsername = `sales_api_${Date.now()}`;
    const createRes = await makeRequest({
        path: '/api/users',
        method: 'POST'
    }, {
        username: apiUsername,
        password: 'pass_api_123',
        displayName: 'Sales API User',
        discordChannelId: '1122334455'
    });

    assert.strictEqual(createRes.status, 200);
    assert(createRes.body.success, 'API tạo nhân viên phải thành công');
    const newStaffId = createRes.body.user.id;

    // 2.2 Lấy danh sách nhân viên GET /api/users
    const listRes = await makeRequest({
        path: '/api/users',
        method: 'GET'
    });
    assert.strictEqual(listRes.status, 200);
    assert(listRes.body.users.some(u => u.username === apiUsername), 'Danh sách nhân viên phải chứa nhân viên mới tạo');

    // 2.3 Đăng nhập lấy token của nhân viên mới
    const loginRes = await makeRequest({
        path: '/api/auth/login',
        method: 'POST'
    }, {
        username: apiUsername,
        password: 'pass_api_123'
    });
    assert.strictEqual(loginRes.status, 200);
    const token = loginRes.body.token;
    assert(token, 'Phải nhận được JWT token của nhân viên');

    // 2.4 Đổi mật khẩu qua API PUT /api/users/:id
    const updateRes = await makeRequest({
        path: `/api/users/${newStaffId}`,
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
    }, {
        password: 'pass_api_updated_789'
    });
    assert.strictEqual(updateRes.status, 200);
    assert(updateRes.body.success, 'Đổi mật khẩu qua API thành công');
    console.log('✓ Test 2 ĐẠT: Toàn bộ API Quản lý & Cấp tài khoản nhân viên hoạt động chuẩn xác.');

    // 3. Kiểm thử API Xóa nhóm FB và Quét nhóm FB
    console.log('\n[Test 3] Kiểm thử Xóa nhóm và Quét nhóm Facebook');
    
    // Thêm 1 nhóm FB test cho user này
    const groupInsertRes = await dbAsync.run(
        `INSERT INTO fb_groups (name, url, member_count, is_active, user_id) VALUES (?, ?, ?, 1, ?)`,
        ['Nhóm Nhà Đất Test', `https://www.facebook.com/groups/test_${Date.now()}/`, '10.500', newStaffId]
    );
    const testGroupId = groupInsertRes.id;

    // Xóa nhóm bằng DELETE /api/fb/groups/:id
    const deleteGroupRes = await makeRequest({
        path: `/api/fb/groups/${testGroupId}`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(deleteGroupRes.status, 200);
    assert(deleteGroupRes.body.success, 'Xóa nhóm FB qua API thành công');

    const checkGroup = await dbAsync.get(`SELECT * FROM fb_groups WHERE id = ?`, [testGroupId]);
    assert.strictEqual(checkGroup, undefined, 'Nhóm đã xóa không còn tồn tại trong DB');

    // Quét nhóm khi chưa kết nối Facebook phải trả về thông báo lỗi rõ ràng
    const scanWithoutFbRes = await makeRequest({
        path: '/api/fb/scan-groups',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(scanWithoutFbRes.status, 400);
    assert(scanWithoutFbRes.body.message.includes('Chưa kết nối Facebook'), 'Phải yêu cầu kết nối Facebook trước khi quét nhóm');
    console.log('✓ Test 3 ĐẠT: Xóa nhóm và xác thực điều kiện Quét nhóm FB hoạt động đúng.');

    // 4. Kiểm thử API Đăng nhập Facebook trực tiếp (Validation & Payload)
    console.log('\n[Test 4] Kiểm thử API Đăng nhập Facebook trực tiếp');
    // Trường hợp thiếu email/password
    const emptyLoginRes = await makeRequest({
        path: '/api/fb/login-credentials',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    }, {
        email: '',
        password: ''
    });
    assert.strictEqual(emptyLoginRes.status, 400);
    assert(emptyLoginRes.body.message.includes('đầy đủ Email'), 'Phải bắt buộc nhập email và mật khẩu');

    // Dọn dẹp nhân viên test
    await dbAsync.deleteUser(newStaffId);
    server.close();

    console.log('✓ Test 4 ĐẠT: Validation đăng nhập trực tiếp Facebook an toàn.');
    console.log('\n======================================================');
    console.log('🎉 TẤT CẢ CÁC BỘ KIỂM THỬ ĐÃ VƯỢT QUA 100%! HỆ THỐNG SẴN SÀNG!');
    console.log('======================================================\n');
}

runTests().catch(err => {
    console.error('❌ Lỗi kiểm thử:', err);
    process.exit(1);
});
