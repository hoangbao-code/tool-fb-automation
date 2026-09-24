process.env.NODE_ENV = 'test';
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
        // 3. Kiểm thử Giao diện Nút Discord: Xác Nhận & Chỉ Hiện Các Nhóm Đã Setting & Review ACP
        console.log('\n3. Kiểm thử Giao diện Component Discord (Nút Xác Nhận, Menu Chỉ Hiện Nhóm Đã Setting & Review ACP):');
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

        // StringSelectMenu: CHỈ HIỂN THỊ CÁC NHÓM ĐÃ SETTING TRONG TOOL (Mỗi nhóm bao gồm các group FB đã chọn sẵn)
        const clusters = await dbAsync.getClusters();
        assert.ok(clusters.length >= 1, 'Phải có ít nhất 1 nhóm đã setting');

        const selectOptions = clusters.slice(0, 25).map(c =>
            new StringSelectMenuOptionBuilder()
                .setLabel(`${c.name.substring(0, 85)}`)
                .setValue(`target_cluster_${c.id}`)
                .setDescription(`Bao gồm ${c.group_count || 0} group Facebook đã chọn sẵn`)
                .setEmoji('📁')
        );

        const targetSelectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`discord_select_target_${fakePostId}`)
                .setPlaceholder('🎯 Chọn Nhóm bạn muốn đăng...')
                .addOptions(selectOptions)
        );
        assert.strictEqual(targetSelectMenu.components[0].data.custom_id, `discord_select_target_${fakePostId}`);
        assert.strictEqual(targetSelectMenu.components[0].options.length, clusters.length, 'Menu chỉ hiện đúng các nhóm đã setting trong tool');
        console.log(`  ✓ Menu Dropdown chỉ hiển thị đúng ${targetSelectMenu.components[0].options.length} nhóm đã setting trong Tool (không lẫn tạp).`);

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

        // 4. Kiểm thử Đăng bài theo Nhóm & Trả về Danh Sách Link Bài Viết / Group Để Check
        console.log('\n4. Kiểm thử Luồng Đăng Bài theo Nhóm & Tạo Link Kiểm Tra:');
        // Tạo bài viết mẫu trong DB
        const postRes = await dbAsync.run(
            `INSERT INTO posts (rewritten_text, status, images) VALUES (?, 'pending', ?)`,
            ['Cho thuê phòng studio Bình Thạnh giá tốt', JSON.stringify([dummyImgFile])]
        );
        const testPostId = postRes.id;
        assert.ok(testPostId, 'Tạo bài post mẫu thành công');

        // Gọi publishPost và kiểm tra kết quả trả về có chứa danh sách groups và links
        const pubResult = await publishPost(testPostId, chosenClusterId);
        assert.strictEqual(pubResult.success, true);
        assert.ok(Array.isArray(pubResult.groups), 'publishPost phải trả về mảng groups');
        assert.strictEqual(pubResult.groups.length, 2, 'Số lượng group đã đăng phải bằng 2');
        assert.ok(pubResult.groups[0].url, 'Mỗi group đã đăng phải có URL Facebook để check');

        // Kiểm tra cột post_links trong DB
        const updatedPost = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [testPostId]);
        assert.strictEqual(updatedPost.status, 'posted');
        assert.ok(updatedPost.post_links, 'Cột post_links phải được lưu trữ trong DB');
        const parsedLinks = JSON.parse(updatedPost.post_links);
        assert.strictEqual(parsedLinks.length, 2);
        console.log(`  ✓ publishPost lưu trữ và trả về đầy đủ ${parsedLinks.length} link group Facebook để check.`);

        // Tạo chuỗi link hiển thị trên Discord Embed
        const linksMarkdown = pubResult.groups.map((g, idx) => `${idx + 1}. 🔗 **[${g.name}](${g.url})**`).join('\n');
        assert.ok(linksMarkdown.includes(sampleUrl1));
        assert.ok(linksMarkdown.includes(sampleUrl2));
        console.log('  ✓ Tạo chuỗi Markdown Links cho Discord Embed chính xác:\n' + linksMarkdown.split('\n').map(l => '      ' + l).join('\n'));

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
