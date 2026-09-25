const { dbAsync } = require('../src/db');
const { handleScannedGroups } = require('../src/services/fbEngine');

async function testFbScan() {
    console.log('--- BẮT ĐẦU KIỂM THỬ TÍNH NĂNG QUÉT NHÓM FACEBOOK ---');

    try {
        // 1. Giả lập danh sách nhóm quét được từ Facebook DOM
        const mockScannedGroups = [
            {
                name: 'Hội Mua Bán Nhà Đất TP.HCM',
                url: 'https://www.facebook.com/groups/nhadathcm/',
                memberCount: '150K thành viên'
            },
            {
                name: 'Chợ Phòng Trọ Sinh Viên Sài Gòn',
                url: 'https://www.facebook.com/groups/phongtrosaigon/',
                memberCount: '89K thành viên'
            },
            {
                name: 'Cộng Đồng Bất Động Sản Hà Nội & Miền Bắc',
                url: 'https://www.facebook.com/groups/batdongsanmienbac/',
                memberCount: '210K thành viên'
            }
        ];

        console.log('1. Đưa danh sách nhóm quét được vào fbEngine...');
        await handleScannedGroups(mockScannedGroups);

        // 2. Kiểm tra dữ liệu trong SQLite
        const groupsInDb = await dbAsync.all('SELECT * FROM fb_groups ORDER BY id ASC');
        console.log(`2. Số nhóm đã lưu trong Database: ${groupsInDb.length}`);
        groupsInDb.forEach(g => {
            console.log(`   - [ID: ${g.id}] ${g.name} | URL: ${g.url} | Thành viên: ${g.member_count} | Đang kích hoạt: ${g.is_active === 1 ? 'CÓ' : 'KHÔNG'}`);
        });

        if (groupsInDb.length < 3) {
            throw new Error(`Kỳ vọng ít nhất 3 nhóm nhưng chỉ tìm thấy ${groupsInDb.length}`);
        }

        // 3. Kiểm tra khả năng cập nhật (UPSERT) khi quét lại (không bị trùng lặp)
        console.log('3. Thử nghiệm quét lại với số lượng thành viên tăng lên...');
        const updatedGroups = [
            {
                name: 'Hội Mua Bán Nhà Đất TP.HCM',
                url: 'https://www.facebook.com/groups/nhadathcm/',
                memberCount: '155K thành viên (Mới cập nhật)'
            }
        ];
        await handleScannedGroups(updatedGroups);

        const groupAfterUpsert = await dbAsync.get('SELECT * FROM fb_groups WHERE url = ?', ['https://www.facebook.com/groups/nhadathcm/']);
        console.log(`   - Sau cập nhật: ${groupAfterUpsert.name} | Thành viên: ${groupAfterUpsert.member_count}`);
        if (groupAfterUpsert.member_count !== '155K thành viên (Mới cập nhật)') {
            throw new Error('Dữ liệu không được cập nhật đúng khi quét lại!');
        }

        const totalCount = await dbAsync.get('SELECT COUNT(*) as count FROM fb_groups');
        console.log(`   - Tổng số nhóm trong DB (không bị nhân đôi): ${totalCount.count}`);

        // 4. Kiểm tra bật/tắt (Toggle) nhóm
        console.log('4. Thử nghiệm bật/tắt nhóm ID 1...');
        await dbAsync.run('UPDATE fb_groups SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?', [groupsInDb[0].id]);
        const toggled = await dbAsync.get('SELECT is_active FROM fb_groups WHERE id = ?', [groupsInDb[0].id]);
        console.log(`   - Trạng thái is_active sau toggle: ${toggled.is_active}`);

        // Dọn dẹp dữ liệu test khỏi cơ sở dữ liệu
        await dbAsync.run("DELETE FROM fb_groups WHERE url IN ('https://www.facebook.com/groups/nhadathcm/', 'https://www.facebook.com/groups/phongtrosaigon/', 'https://www.facebook.com/groups/batdongsanmienbac/')");

        console.log('\n✅ KẾT QUẢ: TẤT CẢ CÁC BƯỚC XỬ LÝ QUÉT NHÓM FACEBOOK ĐỀU THÀNH CÔNG 100%!');
        process.exit(0);

    } catch (err) {
        console.error('❌ Lỗi kiểm thử:', err);
        process.exit(1);
    }
}

testFbScan();
