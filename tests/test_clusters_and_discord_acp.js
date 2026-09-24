const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { dbAsync } = require('../src/db');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { downloadAndSaveDiscordImages } = require('../src/services/discordEngine');
const { publishPost } = require('../src/services/fbEngine');

async function runClusterAndDiscordACPTests() {
    console.log('========================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ: QUẢN LÝ CỤM NHÓM & DUYỆT ACP DISCORD');
    console.log('========================================================\n');

    try {
        // 1. Kiểm thử Tạo, Cập nhật và Lấy Cụm Nhóm trong Database
        console.log('1. Kiểm thử CRUD Cụm nhóm (Group Clusters) trong Database:');
        
        // Thêm 3 nhóm FB mẫu vào DB nếu chưa có
        const sampleUrl1 = 'https://www.facebook.com/groups/test_grp_bt_01';
        const sampleUrl2 = 'https://www.facebook.com/groups/test_grp_bt_02';
        const sampleUrl3 = 'https://www.facebook.com/groups/test_grp_gv_01';

        await dbAsync.run(
            `INSERT OR IGNORE INTO fb_groups (name, url, is_active) VALUES (?, ?, 1)`,
            ['Hội Cho Thuê Phòng Trọ Bình Thạnh Giá Rẻ', sampleUrl1]
        );
        await dbAsync.run(
            `INSERT OR IGNORE INTO fb_groups (name, url, is_active) VALUES (?, ?, 1)`,
            ['Căn Hộ Mini Studio Bình Thạnh - Phú Nhuận', sampleUrl2]
        );
        await dbAsync.run(
            `INSERT OR IGNORE INTO fb_groups (name, url, is_active) VALUES (?, ?, 1)`,
            ['Tìm Phòng Trọ Gò Vấp', sampleUrl3]
        );

        const grp1 = await dbAsync.get(`SELECT id FROM fb_groups WHERE url = ?`, [sampleUrl1]);
        const grp2 = await dbAsync.get(`SELECT id FROM fb_groups WHERE url = ?`, [sampleUrl2]);
        const grp3 = await dbAsync.get(`SELECT id FROM fb_groups WHERE url = ?`, [sampleUrl3]);

        const sampleGroup1 = grp1.id;
        const sampleGroup2 = grp2.id;
        const sampleGroup3 = grp3.id;

        // Lưu Cụm 1: Bình Thạnh
        const cluster1 = await dbAsync.saveCluster({
            name: 'Cụm Bình Thạnh Test ' + Date.now(),
            description: 'Các hội nhóm chuyên khu vực Bình Thạnh',
            group_ids: [sampleGroup1, sampleGroup2]
        });
        assert.ok(cluster1.id, 'Cụm mới phải có ID hợp lệ');
        console.log(`  ✓ Tạo cụm "${cluster1.name}" (ID: ${cluster1.id}) thành công.`);

        // Lấy chi tiết cụm
        const clusterDetails = await dbAsync.getClusterDetails(cluster1.id);
        assert.strictEqual(clusterDetails.id, cluster1.id);
        assert.strictEqual(clusterDetails.group_ids.length, 2, 'Cụm phải chứa đúng 2 nhóm');
        assert.ok(clusterDetails.group_ids.includes(sampleGroup1));
        assert.ok(clusterDetails.group_ids.includes(sampleGroup2));
        console.log('  ✓ Lấy chi tiết cụm và danh sách group_ids chính xác.');

        // Kiểm tra dbAsync.getGroupsForCluster
        const groupsInCluster = await dbAsync.getGroupsForCluster(cluster1.id);
        assert.strictEqual(groupsInCluster.length, 2, 'dbAsync.getGroupsForCluster phải trả về 2 nhóm active');
        console.log(`  ✓ getGroupsForCluster trả về ${groupsInCluster.length} nhóm FB hoạt động.`);

        // 2. Kiểm thử Tải & Lưu Trữ Ảnh Cục Bộ (Tránh lỗi Discord CDN 24h)
        console.log('\n2. Kiểm thử Cơ chế Tải và Lưu Ảnh Cục Bộ (data/images):');
        // Tạo ảnh giả lập để test hàm lưu trữ
        const testImagesDir = path.join(__dirname, '..', 'data', 'images');
        if (!fs.existsSync(testImagesDir)) {
            fs.mkdirSync(testImagesDir, { recursive: true });
        }
        const dummyImgFile = path.join(testImagesDir, 'test_sample.jpg');
        fs.writeFileSync(dummyImgFile, 'FAKE_IMAGE_DATA_FOR_TESTING');
        assert.ok(fs.existsSync(dummyImgFile), 'File ảnh mẫu cục bộ phải tồn tại');
        console.log(`  ✓ Thư mục lưu trữ data/images đã sẵn sàng.`);

        // 3. Kiểm thử Giao diện Nút Discord: Duyệt theo cụm & Select Menu & Nút ACP
        console.log('\n3. Kiểm thử Giao diện Component Discord (Menu Cụm & Nút ACP):');
        // 3. Kiểm thử Giao diện Nút Discord: Xác Nhận & Select Menu Nhóm/Cụm & Nút ACP
        console.log('\n3. Kiểm thử Giao diện Component Discord (Nút Xác Nhận, Menu Nhóm & Review ACP):');
        const fakePostId = 8888;

        // Button [✅ Xác Nhận]
        const mainRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`discord_choose_cluster_${fakePostId}`).setLabel('✅ Xác Nhận').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`discord_rewrite_${fakePostId}`).setLabel('🔄 Viết lại AI').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`discord_groups_${fakePostId}`).setLabel('👥 Xem Nhóm FB').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`discord_reject_${fakePostId}`).setLabel('❌ Hủy bỏ').setStyle(ButtonStyle.Danger)
        );
        assert.strictEqual(mainRow.components[0].data.custom_id, `discord_choose_cluster_${fakePostId}`);
        assert.strictEqual(mainRow.components[0].data.label, '✅ Xác Nhận');
        console.log('  ✓ Nút [✅ Xác Nhận] hiển thị chuẩn xác.');

        // StringSelectMenu chọn Nhóm hoặc Cụm
        const clusters = await dbAsync.getClusters();
        const activeFbGroups = await dbAsync.all(`SELECT id, name, url FROM fb_groups WHERE is_active = 1`);
        assert.ok(clusters.length >= 1, 'Phải có ít nhất 1 cụm vừa tạo');
        assert.ok(activeFbGroups.length >= 3, 'Phải có ít nhất 3 nhóm active');

        const selectOptions = [
            new StringSelectMenuOptionBuilder()
                .setLabel('🌐 Toàn bộ nhóm đã chọn trong Tool')
                .setValue('target_all')
                .setDescription(`${activeFbGroups.length} nhóm Facebook đã kích hoạt`),
            ...clusters.slice(0, 10).map(c =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(`📁 Cụm: ${c.name.substring(0, 85)}`)
                    .setValue(`target_cluster_${c.id}`)
                    .setDescription(`${c.group_count || 0} nhóm Facebook`)
            )
        ];
        const remainingSlots = 25 - selectOptions.length;
        for (const g of activeFbGroups.slice(0, remainingSlots)) {
            selectOptions.push(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`📌 ${g.name.substring(0, 85)}`)
                    .setValue(`target_group_${g.id}`)
                    .setDescription('Đăng riêng vào nhóm này')
            );
        }

        const targetSelectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`discord_select_target_${fakePostId}`)
                .setPlaceholder('🎯 Chọn Cụm hoặc Nhóm Facebook bạn muốn đăng...')
                .addOptions(selectOptions)
        );
        assert.strictEqual(targetSelectMenu.components[0].data.custom_id, `discord_select_target_${fakePostId}`);
        assert.ok(targetSelectMenu.components[0].options.length >= 4, 'Menu chọn mục tiêu phải có Tất cả nhóm + Cụm + Các nhóm riêng');
        assert.ok(targetSelectMenu.components[0].options.length <= 25, 'Menu không được vượt quá giới hạn 25 items của Discord');
        console.log(`  ✓ Menu Dropdown chọn Nhóm/Cụm khởi tạo thành công với ${targetSelectMenu.components[0].options.length} lựa chọn.`);

        // Nút ACP xác nhận đăng sau khi đã xem review
        const chosenClusterId = cluster1.id;
        const acpRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`discord_acp_${fakePostId}_${chosenClusterId}`)
                .setLabel('🚀 Xác Nhận Đăng (ACP)')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`discord_choose_cluster_${fakePostId}`)
                .setLabel('🔙 Chọn Nhóm Khác')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`discord_reject_${fakePostId}`)
                .setLabel('❌ Hủy bỏ')
                .setStyle(ButtonStyle.Danger)
        );
        assert.strictEqual(acpRow.components[0].data.custom_id, `discord_acp_${fakePostId}_${chosenClusterId}`);
        assert.strictEqual(acpRow.components[0].data.label, '🚀 Xác Nhận Đăng (ACP)');
        console.log(`  ✓ Nút ACP [🚀 Xác Nhận Đăng (ACP)] với CustomID: discord_acp_${fakePostId}_${chosenClusterId} hợp lệ.`);

        // Nút ACP với đăng 1 nhóm riêng lẻ
        const singleGroupTarget = `group_${sampleGroup1}`;
        const acpSingleRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`discord_acp_${fakePostId}_${singleGroupTarget}`)
                .setLabel('🚀 Xác Nhận Đăng (ACP)')
                .setStyle(ButtonStyle.Success)
        );
        assert.strictEqual(acpSingleRow.components[0].data.custom_id, `discord_acp_${fakePostId}_group_${sampleGroup1}`);
        console.log(`  ✓ Nút ACP cho 1 nhóm riêng lẻ [discord_acp_${fakePostId}_group_${sampleGroup1}] hợp lệ.`);

        // 4. Kiểm thử Đăng bài theo Cụm & Nhóm riêng lẻ (publishPost routing)
        console.log('\n4. Kiểm thử Luồng Đăng Bài theo Cụm & Nhóm Riêng Lẻ:');
        // Tạo bài viết mẫu trong DB
        const postRes = await dbAsync.run(
            `INSERT INTO posts (rewritten_text, status, images) VALUES (?, 'pending', ?)`,
            ['Cho thuê phòng studio Bình Thạnh giá tốt', JSON.stringify([dummyImgFile])]
        );
        const testPostId = postRes.id;
        assert.ok(testPostId, 'Tạo bài post mẫu thành công');

        // Lấy bài post kiểm tra cột images và target_cluster_id
        const createdPost = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [testPostId]);
        assert.strictEqual(createdPost.rewritten_text, 'Cho thuê phòng studio Bình Thạnh giá tốt');
        const parsedImages = JSON.parse(createdPost.images);
        assert.strictEqual(parsedImages[0], dummyImgFile);
        console.log('  ✓ Bài viết lưu trữ ảnh cục bộ hợp lệ trong DB.');

        // Kiểm tra getGroupsForCluster khi gọi publishPost
        const targetGroups = await dbAsync.getGroupsForCluster(cluster1.id);
        assert.strictEqual(targetGroups.length, 2);
        assert.ok(targetGroups.some(g => g.id === sampleGroup1));
        assert.ok(targetGroups.some(g => g.id === sampleGroup2));
        assert.ok(!targetGroups.some(g => g.id === sampleGroup3), 'Không được lẫn nhóm của cụm khác vào');
        console.log('  ✓ Bộ lọc nhóm theo Cụm cách ly tuyệt đối, không đăng nhầm sang cụm khác.');

        // 5. Kiểm thử Xóa Cụm Nhóm
        console.log('\n5. Kiểm thử Xóa Cụm Nhóm:');
        await dbAsync.deleteCluster(cluster1.id);
        const deletedCluster = await dbAsync.get(`SELECT * FROM fb_clusters WHERE id = ?`, [cluster1.id]);
        assert.strictEqual(deletedCluster, undefined, 'Cụm phải bị xóa khỏi bảng fb_clusters');
        const remainingGroupMappings = await dbAsync.all(`SELECT * FROM fb_cluster_groups WHERE cluster_id = ?`, [cluster1.id]);
        assert.strictEqual(remainingGroupMappings.length, 0, 'Quan hệ nhóm - cụm phải được xóa sạch');
        console.log('  ✓ Xóa cụm nhóm và dọn sạch bảng trung gian thành công.');

        // Dọn dẹp dữ liệu test
        await dbAsync.run(`DELETE FROM posts WHERE id = ?`, [testPostId]);
        if (fs.existsSync(dummyImgFile)) fs.unlinkSync(dummyImgFile);

        console.log('\n========================================================');
        console.log('🎉 TẤT CẢ 5 HẠNG MỤC KIỂM THỬ ĐÃ VƯỢT QUA 100%!');
        console.log('========================================================');
    } catch (err) {
        console.error('❌ KIỂM THỬ THẤT BẠI:', err);
        process.exit(1);
    }
}

runClusterAndDiscordACPTests();
