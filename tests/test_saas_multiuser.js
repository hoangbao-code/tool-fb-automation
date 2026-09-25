const http = require('http');
const { createServer } = require('../src/server');
const { dbAsync } = require('../src/db');

function request(app, options, postData = null) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const reqOptions = {
                hostname: '127.0.0.1',
                port: port,
                path: options.path,
                method: options.method || 'GET',
                headers: options.headers || {}
            };

            if (postData) {
                const bodyStr = typeof postData === 'string' ? postData : JSON.stringify(postData);
                reqOptions.headers['Content-Type'] = 'application/json';
                reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
            }

            const req = http.request(reqOptions, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    server.close();
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ status: res.statusCode, body: parsed });
                    } catch (e) {
                        resolve({ status: res.statusCode, raw: data });
                    }
                });
            });

            req.on('error', (err) => {
                server.close();
                reject(err);
            });

            if (postData) {
                const bodyStr = typeof postData === 'string' ? postData : JSON.stringify(postData);
                req.write(bodyStr);
            }
            req.end();
        });
    });
}

async function runTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ: WEB APP SAAS ĐA NGƯỜI DÙNG & MOBILE API');
    console.log('========================================================\n');

    const app = createServer();

    // 1. Kiểm thử endpoint /api/server-info
    console.log('1. Kiểm thử thông tin máy chủ & link mobile:');
    const infoRes = await request(app, { path: '/api/server-info' });
    if (infoRes.body.success && infoRes.body.accessUrls) {
        console.log('  ✓ Lấy server info thành công.');
        console.log('  ✓ Link Mobile Web:', infoRes.body.accessUrls.mobileWeb);
    } else {
        throw new Error('Lỗi lấy server info');
    }

    // 2. Kiểm thử đăng nhập Admin mặc định
    console.log('\n2. Kiểm thử xác thực Admin mặc định:');
    const loginRes = await request(app, { path: '/api/auth/login', method: 'POST' }, {
        username: 'admin',
        password: 'admin123'
    });
    if (loginRes.body.success && loginRes.body.user.role === 'admin') {
        console.log('  ✓ Đăng nhập Admin thành công (Token ID:', loginRes.body.token, ')');
    } else {
        throw new Error('Đăng nhập Admin thất bại');
    }

    // 3. Kiểm thử đăng ký nhân viên mới
    console.log('\n3. Kiểm thử tạo tài khoản Nhân Viên mới:');
    const testUsername = 'nhanvien_' + Date.now();
    const regRes = await request(app, { path: '/api/auth/register', method: 'POST' }, {
        username: testUsername,
        password: 'password123',
        displayName: 'Nhân Viên BĐS Nam Sài Gòn',
        discordChannelId: '998877665544'
    });
    if (regRes.body.success && regRes.body.user.id) {
        console.log(`  ✓ Đăng ký nhân viên [${testUsername}] thành công (User ID: ${regRes.body.user.id}).`);
    } else {
        throw new Error('Đăng ký nhân viên thất bại: ' + (regRes.body.message || ''));
    }

    const staffToken = String(regRes.body.user.id);

    // 4. Kiểm thử lưu phiên Facebook cá nhân cho nhân viên
    console.log('\n4. Kiểm thử lưu phiên Facebook của nhân viên:');
    const cookieRes = await request(app, {
        path: '/api/fb/save-cookies',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${staffToken}` }
    }, {
        cookies: 'c_user=10008899112233; xs=3a4b5c6d7e;',
        accountName: 'Nick Môi Giới Quận 7'
    });
    if (cookieRes.body.success) {
        console.log('  ✓ Lưu cookie Facebook thành công:', cookieRes.body.name);
    } else {
        throw new Error('Lỗi lưu cookie FB');
    }

    const statusRes = await request(app, {
        path: '/api/fb/status',
        headers: { 'Authorization': `Bearer ${staffToken}` }
    });
    if (statusRes.body.connected && statusRes.body.name.includes('Quận 7')) {
        console.log('  ✓ Trạng thái Facebook nhân viên: Đã kết nối 🟢');
    } else {
        throw new Error('Trạng thái FB chưa kết nối đúng');
    }

    // 5. Kiểm thử lưu nhóm Facebook riêng cho nhân viên
    console.log('\n5. Kiểm thử nạp danh sách nhóm FB cho nhân viên:');
    const saveGrpRes = await request(app, {
        path: '/api/fb/save-scanned-groups',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${staffToken}` }
    }, {
        groups: [
            { name: 'Hội Mua Bán Nhà Đất Quận 7', url: 'https://facebook.com/groups/q7_nhadat_test_' + Date.now(), memberCount: '45k thành viên' },
            { name: 'Căn Hộ Cho Thuê Phú Mỹ Hưng', url: 'https://facebook.com/groups/pmh_chothue_test_' + Date.now(), memberCount: '28k thành viên' }
        ]
    });
    if (saveGrpRes.body.success && saveGrpRes.body.count === 2) {
        console.log('  ✓ Đã lưu thành công 2 nhóm FB cho nhân viên ID:', staffToken);
    } else {
        throw new Error('Lỗi lưu nhóm FB cho nhân viên');
    }

    // 6. Kiểm thử tạo Cụm Nhóm riêng cho nhân viên
    console.log('\n6. Kiểm thử tạo Cụm Nhóm Facebook cho nhân viên:');
    const clusterRes = await request(app, {
        path: '/api/clusters',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${staffToken}` }
    }, {
        name: 'Cụm Nhà Đất Q7 Nhân Viên ' + Date.now(),
        description: 'Chuyên căn hộ cao cấp và nhà phố',
        groupIds: [1]
    });
    if (clusterRes.body.success && clusterRes.body.cluster.id) {
        console.log('  ✓ Tạo cụm nhóm thành công:', clusterRes.body.cluster.name);
    } else {
        throw new Error('Lỗi tạo cụm nhóm');
    }

    // 7. Kiểm thử lấy danh sách cụm nhóm của nhân viên
    const listClustersRes = await request(app, {
        path: '/api/clusters',
        headers: { 'Authorization': `Bearer ${staffToken}` }
    });
    if (listClustersRes.body.success && listClustersRes.body.clusters.length > 0) {
        console.log(`  ✓ Lấy danh sách cụm thành công (${listClustersRes.body.clusters.length} cụm).`);
    } else {
        throw new Error('Lỗi lấy danh sách cụm');
    }

    // 8. Dọn dẹp dữ liệu kiểm thử
    await dbAsync.run(`DELETE FROM fb_clusters WHERE user_id = ?`, [staffToken]);
    await dbAsync.run(`DELETE FROM fb_groups WHERE user_id = ?`, [staffToken]);
    await dbAsync.run(`DELETE FROM users WHERE id = ?`, [staffToken]);
    console.log('  ✓ Đã dọn dẹp sạch tài khoản, cụm nhóm và dữ liệu test.');

    console.log('\n========================================================');
    console.log('🎉 TẤT CẢ 7 HẠNG MỤC KIỂM THỬ SAAS WEB APP ĐÃ VƯỢT QUA 100%!');
    console.log('========================================================');
}

runTests().catch(err => {
    console.error('❌ KIỂM THỬ THẤT BẠI:', err);
    process.exit(1);
});
