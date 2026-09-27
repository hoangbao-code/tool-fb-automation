const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    REST,
    Routes,
    SlashCommandBuilder,
    Events
} = require('discord.js');
const { dbAsync } = require('../db');
const { rewriteWithGemini } = require('./gemini');
const { publishPost } = require('./fbEngine');
const { publishPostForUser } = require('./multiFbEngine');
const { isChromeDebuggingActive } = require('./chromeGemini');
const { generateLicenseKey, verifyLicenseKey, getMachineHWID } = require('./licenseEngine');

let discordClient = null;
let currentConfig = null;
let eventBroadcaster = null;

/**
 * Tìm thông tin User (Admin hoặc Nhân viên) tương ứng với Kênh Discord
 * Cho phép 1 Bot phục vụ nhiều kênh độc lập cho từng nhân viên không bị xung đột
 */
async function getUserForDiscordChannel(channelId) {
    if (!channelId) return null;
    try {
        // 1. Tìm nhân viên được gán kênh này trong bảng users
        const user = await dbAsync.get(
            `SELECT id, username, display_name, role, discord_channel_id FROM users WHERE discord_channel_id = ? AND discord_channel_id != ''`,
            [channelId]
        );
        if (user) return user;

        // 2. Nếu là kênh chính của Admin (cấu hình trong Tool Desktop)
        if (currentConfig && channelId === currentConfig.channelId) {
            const admin = await dbAsync.getUserById(1);
            return admin || { id: 1, username: 'admin', role: 'admin', display_name: 'Quản Trị Viên' };
        }
    } catch (e) {
        console.error('[Discord] Lỗi tìm user theo channelId:', e);
    }
    return null;
}

// Thư mục lưu trữ ảnh mặc định từ Discord
const defaultImagesDir = path.join(__dirname, '..', '..', 'data', 'images');

/**
 * Lấy thư mục lưu ảnh thực tế (do người dùng chỉ định trong Cài đặt hoặc mặc định data/images)
 */
async function getEffectiveImagesDir() {
    try {
        const row = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_image_save_dir'`);
        if (row && row.value && row.value.trim().length > 0) {
            const customDir = row.value.trim();
            if (!fs.existsSync(customDir)) {
                fs.mkdirSync(customDir, { recursive: true });
            }
            return customDir;
        }
    } catch (e) {
        console.warn('[DiscordEngine] Không thể đọc cấu hình discord_image_save_dir:', e.message);
    }

    if (!fs.existsSync(defaultImagesDir)) {
        try { fs.mkdirSync(defaultImagesDir, { recursive: true }); } catch (e) {}
    }
    return defaultImagesDir;
}

// Quản lý bộ đệm tin nhắn (Debounce 60 giây) cho từng kênh
const channelBuffers = new Map();

function setDiscordEventBroadcaster(fn) {
    eventBroadcaster = fn;
}

/**
 * Trích xuất link ảnh và file nén zip từ tin nhắn Discord
 */
function extractMediaAttachments(message) {
    const images = [];
    const zips = [];
    if (message.attachments && message.attachments.size > 0) {
        message.attachments.forEach(att => {
            const fileName = att.name || '';
            const contentType = att.contentType || '';
            const url = att.url;

            const isImage = (contentType && contentType.startsWith('image/')) ||
                /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName || url);

            const isZip = contentType === 'application/zip' ||
                contentType === 'application/x-zip-compressed' ||
                (contentType === 'application/octet-stream' && /\.zip$/i.test(fileName)) ||
                /\.zip$/i.test(fileName || url);

            if (isImage) {
                images.push(url);
            } else if (isZip) {
                zips.push({ url, name: fileName || 'archive.zip' });
            }
        });
    }
    return { images, zips };
}

/**
 * Giữ hàm cũ để tương thích
 */
function extractImageUrls(message) {
    return extractMediaAttachments(message).images;
}

/**
 * Tự động tải và giải nén file zip từ Discord, trích xuất tất cả ảnh bên trong
 * Hỗ trợ cả file zip online (URL) lẫn file zip cục bộ
 */
async function extractImagesFromDiscordZips(zipList, postId) {
    if (!Array.isArray(zipList) || zipList.length === 0) return [];
    const imagesDir = await getEffectiveImagesDir();

    const extractedImagePaths = [];

    for (let z = 0; z < zipList.length; z++) {
        const item = zipList[z];
        const zipUrl = typeof item === 'string' ? item : item.url;
        const zipName = (typeof item === 'object' && item.name) ? item.name : (typeof item === 'string' ? path.basename(item) : `archive_${z + 1}.zip`);

        try {
            console.log(`[DiscordEngine] Đang xử lý file zip: ${zipName}...`);
            let admZip = null;

            // Nếu là đường dẫn file cục bộ (dùng trong test hoặc file đã tải)
            if (typeof zipUrl === 'string' && fs.existsSync(zipUrl)) {
                admZip = new AdmZip(zipUrl);
            } else {
                // Tải từ Discord URL
                const res = await fetch(zipUrl, { signal: AbortSignal.timeout(60000) });
                if (!res.ok) {
                    console.warn(`[DiscordEngine] Không thể tải file zip (HTTP ${res.status}): ${zipUrl}`);
                    continue;
                }
                const arrayBuffer = await res.arrayBuffer();
                admZip = new AdmZip(Buffer.from(arrayBuffer));
            }

            const entries = admZip.getEntries();
            let countInZip = 0;

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (entry.isDirectory) continue;

                const entryName = entry.entryName || '';
                // Bỏ qua rác macOS / Windows
                if (entryName.includes('__MACOSX') || entry.name.startsWith('._') || entry.name.startsWith('.') || entryName.toLowerCase().includes('thumbs.db')) {
                    continue;
                }

                // Kiểm tra định dạng ảnh
                const extMatch = entry.name.match(/\.(png|jpe?g|webp|gif|bmp)$/i);
                if (extMatch) {
                    try {
                        const ext = extMatch[1].toLowerCase();
                        const rawBase = path.basename(entry.name, path.extname(entry.name));
                        const baseClean = rawBase.replace(/[^a-zA-Z0-9_\-]/g, '_');
                        const savedFileName = `post_${postId || Date.now()}_zip_${z + 1}_${i + 1}_${baseClean || 'photo'}_${Date.now()}.${ext}`;
                        const targetFilePath = path.join(imagesDir, savedFileName);

                        const imgBuffer = admZip.readFile(entry);
                        if (imgBuffer && imgBuffer.length > 0) {
                            fs.writeFileSync(targetFilePath, imgBuffer);
                            extractedImagePaths.push(targetFilePath);
                            countInZip++;
                        }
                    } catch (entryErr) {
                        console.warn(`[DiscordEngine] Lỗi trích xuất file ${entry.name} trong zip:`, entryErr.message);
                    }
                }
            }

            console.log(`[DiscordEngine] Đã giải nén ${countInZip} ảnh từ file zip "${zipName}".`);
            await dbAsync.log('info', `[Discord Bot] Đã tự động giải nén thành công ${countInZip} ảnh từ file zip "${zipName}".`);
        } catch (zipErr) {
            console.error(`[DiscordEngine] Lỗi khi giải nén file zip "${zipName}":`, zipErr.message);
            await dbAsync.log('warn', `[Discord Bot] Lỗi khi xử lý file zip "${zipName}": ${zipErr.message}`);
        }
    }

    return extractedImagePaths;
}

/**
 * Tải file ảnh từ Discord và lưu trữ vĩnh viễn trên máy tính cục bộ
 * Tránh lỗi link CDN của Discord bị hết hạn sau 24h
 */
async function downloadAndSaveDiscordImages(imageUrls, postId) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) return [];
    const imagesDir = await getEffectiveImagesDir();
    const savedPaths = [];
    for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const extMatch = pathname.match(/\.(png|jpe?g|webp|gif|bmp)/i);
            const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
            const filename = `post_${postId || Date.now()}_img_${i + 1}_${Date.now()}.${ext}`;
            const targetPath = path.join(imagesDir, filename);

            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (res.ok) {
                const arrayBuffer = await res.arrayBuffer();
                fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
                savedPaths.push(targetPath);
                console.log(`[DiscordEngine] Đã tải & lưu trữ ảnh cục bộ: ${targetPath}`);
            } else {
                console.warn(`[DiscordEngine] Không thể tải ảnh (HTTP ${res.status}): ${url}`);
                savedPaths.push(url);
            }
        } catch (err) {
            console.error(`[DiscordEngine] Lỗi tải ảnh ${url}:`, err.message);
            savedPaths.push(url);
        }
    }
    return savedPaths;
}

// Bộ nhớ tạm lưu các postId vừa phản hồi qua interaction Discord để tránh gửi đúp
const notifiedInteractionPostIds = new Set();

/**
 * Tạo Discord Embed hiển thị kết quả xuất bản bài viết
 * Tự động phân loại: Đang chờ duyệt (cam) vs Đã đăng công khai (xanh) vs Hỗn hợp (lam)
 */
function buildPublishResultEmbed(postId, targetLabel, postedGroups = [], failedGroups = []) {
    const pendingGroups = (postedGroups || []).filter(g => g.status === 'pending_approval');
    const directGroups = (postedGroups || []).filter(g => g.status === 'posted');

    let title = '';
    let color = 0x2ecc71;
    let introText = '';

    if (directGroups.length === 0 && pendingGroups.length > 0) {
        // TẤT CẢ VÀO HÀNG CHỜ PHÊ DUYỆT
        title = `⏳ BÀI VIẾT #${postId} ĐANG CHỜ PHÊ DUYỆT!`;
        color = 0xf39c12; // Màu vàng cam cảnh báo
        introText = `⚠️ Bài viết đã được gửi vào **Nhóm [${targetLabel}]** (${pendingGroups.length} group) nhưng **đang nằm trong hàng chờ Quản trị viên phê duyệt** (do nhóm bật kiểm duyệt bài đăng)!\n\n👉 Bạn hãy bấm vào liên kết bên dưới để xem bài viết đang chờ duyệt trên Facebook:`;
    } else if (pendingGroups.length > 0) {
        // HỖN HỢP: VỪA CÓ NHÓM ĐĂNG NGAY, VỪA CÓ NHÓM CHỜ DUYỆT
        title = `📢 BÀI VIẾT #${postId} ĐÃ XUẤT BẢN (${directGroups.length} đã đăng, ${pendingGroups.length} chờ duyệt)`;
        color = 0x3498db; // Xanh lam
        introText = `Bài viết đã xuất bản vào **Nhóm [${targetLabel}]** (${postedGroups.length} group):\n- ✅ **${directGroups.length}** nhóm đã đăng công khai trực tiếp\n- ⏳ **${pendingGroups.length}** nhóm đang chờ Quản trị viên duyệt\n\n👉 Bấm vào liên kết bên dưới để xem bài viết:`;
    } else {
        // TẤT CẢ ĐÃ ĐĂNG TRỰC TIẾP
        title = `🎉 ĐÃ ĐĂNG BÀI #${postId} THÀNH CÔNG!`;
        color = 0x2ecc71; // Xanh lá
        introText = `✅ Bài viết đã hoàn tất đăng trực tiếp vào **Nhóm [${targetLabel}]** (${directGroups.length} group) an toàn!\n\n🔗 **LINK BÀI VIẾT ĐÃ ĐĂNG (BẤM VÀO ĐỂ XEM):**`;
    }

    let linksListStr = '';
    if (postedGroups.length > 0) {
        linksListStr = postedGroups.map((g, idx) => {
            const isPending = (g.status === 'pending_approval');
            const targetLink = g.postUrl || g.url || 'https://www.facebook.com/groups';
            const icon = isPending ? '⏳' : '✅';
            const statusLabel = isPending ? '**ĐANG CHỜ PHÊ DUYỆT**' : '**ĐÃ ĐĂNG CÔNG KHAI**';
            const actionText = isPending ? 'Xem bài đang chờ duyệt' : 'Xem bài viết trực tiếp';
            return `${idx + 1}. ${icon} **[${g.name}](${targetLink})** — ${statusLabel}\n   ↳ 🔗 [${actionText}](${targetLink})`;
        }).join('\n\n');
    } else {
        linksListStr = '*(Không tìm thấy danh sách link group)*';
    }

    if (failedGroups.length > 0) {
        linksListStr += '\n\n❌ **Nhóm đăng thất bại:**\n';
        linksListStr += failedGroups.map(f => `- **${f.name}**: ${f.error}`).join('\n');
    }

    if (linksListStr.length > 3800) {
        linksListStr = linksListStr.substring(0, 3800) + '\n... và một số group khác.';
    }

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`${introText}\n\n${linksListStr}`)
        .setFooter({ text: 'Bấm thẳng vào link từng group ở trên để mở Facebook và kiểm tra bài viết!' })
        .setTimestamp();
}

/**
 * Gửi thông báo kết quả đăng bài trực tiếp vào Kênh Discord tương ứng
 * Tự động nhận diện bài chờ phê duyệt hay đã đăng thành công
 */
async function notifyDiscordPostResult(postId, result) {
    if (!discordClient || !discordClient.isReady()) return;
    if (notifiedInteractionPostIds.has(postId)) return;

    try {
        const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postId]);
        if (!post) return;

        // Xác định channelId cần gửi
        let targetChannelId = null;
        if (post.user_id) {
            const user = await dbAsync.getUserById(post.user_id);
            if (user?.discord_channel_id) {
                targetChannelId = user.discord_channel_id;
            }
        }

        if (!targetChannelId && currentConfig?.channelId) {
            targetChannelId = currentConfig.channelId;
        }

        if (!targetChannelId) return;

        const channel = await discordClient.channels.fetch(targetChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        const postedGroups = result.groups || [];
        const failedGroups = result.failed || [];
        const targetLabel = post.target_fb_group || 'Nhóm Facebook';
        const embed = buildPublishResultEmbed(postId, targetLabel, postedGroups, failedGroups);

        await channel.send({ embeds: [embed] });
        console.log(`[DiscordEngine] Đã gửi thông báo xuất bản bài #${postId} tới kênh Discord #${channel.name || targetChannelId}`);
    } catch (err) {
        console.warn(`[DiscordEngine] Lỗi gửi thông báo xuất bản bài #${postId} vào Discord:`, err.message);
    }
}

/**
 * Tạo giao diện nút bấm duyệt bài cho Discord
 */
function createApprovalButtons(postId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`discord_choose_cluster_${postId}`)
            .setLabel('✅ Xác Nhận')
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`discord_rewrite_${postId}`)
            .setLabel('🔄 Viết lại AI')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`discord_groups_${postId}`)
            .setLabel('👥 Xem Nhóm FB')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`discord_reject_${postId}`)
            .setLabel('❌ Hủy bỏ')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(disabled)
    );
}

/**
 * Xử lý gom cụm và gửi sang Gemini Web sau khi dừng 1 phút (Debounce)
 */
async function processDiscordBuffer(channelId) {
    const buffer = channelBuffers.get(channelId);
    if (!buffer) return;
    channelBuffers.delete(channelId);

    const { channel, texts, images, zips = [], username, userTag, userId = 1 } = buffer;
    const combinedText = texts.filter(Boolean).join('\n\n').trim();
    const uniqueImages = [...new Set(images)];

    // Khử trùng lặp file zip
    const uniqueZips = [];
    const seenZipUrls = new Set();
    for (const z of zips) {
        const u = typeof z === 'string' ? z : z.url;
        if (u && !seenZipUrls.has(u)) {
            seenZipUrls.add(u);
            uniqueZips.push(typeof z === 'string' ? { url: z, name: 'archive.zip' } : z);
        }
    }

    if (!combinedText && uniqueImages.length === 0 && uniqueZips.length === 0) return;

    const mediaDesc = [];
    if (uniqueImages.length > 0) mediaDesc.push(`${uniqueImages.length} ảnh trực tiếp`);
    if (uniqueZips.length > 0) mediaDesc.push(`${uniqueZips.length} file zip`);
    const mediaDescStr = mediaDesc.length > 0 ? mediaDesc.join(' + ') : 'không có ảnh';

    await dbAsync.log('info', `[Discord Bot] Đã hết thời gian chờ gom (${userTag || username} - User #${userId}). Bắt đầu xử lý bài đăng (${combinedText.length} ký tự, ${mediaDescStr})...`);

    // Gửi thông báo đang xử lý vào Discord
    let statusMsg = null;
    try {
        const zipNote = uniqueZips.length > 0 ? `📦 Đang tự động giải nén ${uniqueZips.length} file zip... ` : '';
        statusMsg = await channel.send(`⏳ **Đã gom xong bài (${mediaDescStr})!** ${zipNote}Đang lưu ảnh và gửi vào Google Chrome Gemini Web để biên tập lại nội dung...`);
    } catch (e) {
        console.warn('[Discord] Không thể gửi status message:', e.message);
    }

    // Tải toàn bộ ảnh trực tiếp và giải nén toàn bộ ảnh trong các file zip
    const currentTimestamp = Date.now();
    const localDirectImages = await downloadAndSaveDiscordImages(uniqueImages, currentTimestamp);
    const localZipImages = await extractImagesFromDiscordZips(uniqueZips, currentTimestamp);
    const allLocalImages = [...localDirectImages, ...localZipImages];

    // 1. Lưu tin nhắn gốc vào bảng messages
    let msgRecord = null;
    try {
        msgRecord = await dbAsync.run(
            `INSERT INTO messages (group_name, sender, content, images) VALUES (?, ?, ?, ?)`,
            [`Discord: #${channel.name || 'channel'}`, `${userTag || username} (User #${userId})`, combinedText, JSON.stringify(allLocalImages)]
        );
    } catch (e) {
        console.error('[Discord] Lỗi lưu messages vào SQLite:', e);
    }

    // 2. Gửi sang Gemini Web biên tập
    let rewritten = combinedText;
    let aiSuccess = false;
    try {
        rewritten = await rewriteWithGemini(combinedText, username, `Discord #${channel.name || ''}`);
        aiSuccess = true;
    } catch (aiErr) {
        await dbAsync.log('warn', `[Discord] Gemini Web chưa phản hồi: ${aiErr.message}. Sử dụng nội dung gốc.`);
        rewritten = combinedText;
    }

    // 3. Lấy danh sách nhóm Facebook đang bật để chuẩn bị (lọc theo userId của nhân viên)
    let activeFbGroups = [];
    if (userId) {
        activeFbGroups = await dbAsync.all(
            `SELECT name FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
            [userId]
        );
    } else {
        activeFbGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);
    }
    const targetFbStr = activeFbGroups.map(g => g.name).join(', ') || 'Tất cả nhóm đã chọn';

    // 4. Lưu bài viết vào bảng posts (trạng thái pending, gán user_id)
    let postRecord = null;
    try {
        postRecord = await dbAsync.run(
            `INSERT INTO posts (message_id, group_name, original_text, rewritten_text, target_fb_group, status, images, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [msgRecord?.id || null, `Discord: #${channel.name || 'channel'}`, combinedText, rewritten, targetFbStr, 'pending', JSON.stringify(allLocalImages), userId]
        );
    } catch (e) {
        console.error('[Discord] Lỗi lưu posts vào SQLite:', e);
        if (statusMsg) {
            await statusMsg.edit(`❌ Lỗi lưu dữ liệu vào hệ thống: ${e.message}`);
        }
        return;
    }

    const postId = postRecord.id;

    if (eventBroadcaster) {
        eventBroadcaster('new-post-ready', {
            id: postId,
            userId: userId,
            groupName: `Discord: #${channel.name || 'channel'}`,
            originalText: combinedText,
            rewrittenText: rewritten,
            images: allLocalImages,
            status: 'pending',
            targetFbGroup: targetFbStr,
            time: new Date().toLocaleTimeString('vi-VN')
        });
    }

    // 5. Gửi bài viết và các nút bấm Xác nhận trở lại kênh Discord
    try {
        let imageFieldVal = `${allLocalImages.length} ảnh đính kèm`;
        if (uniqueZips.length > 0) {
            imageFieldVal = `${allLocalImages.length} ảnh (${localZipImages.length} ảnh giải nén từ ${uniqueZips.length} file zip)`;
        }

        const embed = new EmbedBuilder()
            .setColor(aiSuccess ? 0x2ecc71 : 0xf39c12)
            .setTitle(`📝 BÀI VIẾT ĐÃ BIÊN TẬP XONG (Mã bài: #${postId})`)
            .setDescription(rewritten.length > 4000 ? rewritten.substring(0, 3995) + '...' : rewritten)
            .addFields(
                { name: '📸 Hình ảnh', value: imageFieldVal, inline: true },
                { name: '🎯 Nhóm FB đích', value: `${activeFbGroups.length} nhóm đang bật`, inline: true },
                { name: '🤖 Trạng thái AI', value: aiSuccess ? '✓ Gemini Web biên tập' : '⚠️ Nội dung gốc (AI bận)', inline: true }
            )
            .setFooter({ text: 'Kiểm tra nội dung phía trên. Bấm [✅ Xác Nhận] bên dưới để chọn nhóm đăng bài!' })
            .setTimestamp();

        // Gửi ảnh xem trước: Ưu tiên link discord nếu có, hoặc đính kèm ảnh cục bộ đã giải nén
        const sendFiles = [];
        if (uniqueImages.length > 0) {
            embed.setImage(uniqueImages[0]);
        } else if (allLocalImages.length > 0 && fs.existsSync(allLocalImages[0])) {
            const previewName = path.basename(allLocalImages[0]);
            sendFiles.push({ attachment: allLocalImages[0], name: previewName });
            embed.setImage(`attachment://${previewName}`);
        }

        const buttonsRow = createApprovalButtons(postId, false);

        const responsePayload = {
            content: `✨ **Bài viết #${postId} đã sẵn sàng!** Vui lòng kiểm tra và bấm nút xác nhận bên dưới:`,
            embeds: [embed],
            components: [buttonsRow]
        };
        if (sendFiles.length > 0) {
            responsePayload.files = sendFiles;
        }

        if (statusMsg) {
            await statusMsg.edit(responsePayload);
        } else {
            await channel.send(responsePayload);
        }

        await dbAsync.log('info', `[Discord Bot] Đã gửi bài #${postId} (${allLocalImages.length} ảnh) kèm nút bấm duyệt vào kênh Discord (#${channel.name}). Đang chờ bạn bấm xác nhận...`);
    } catch (sendErr) {
        console.error('[Discord] Lỗi gửi tin nhắn xác nhận vào Discord:', sendErr);
    }
}

/**
 * Xây dựng Embed báo cáo kết quả tạo License Key
 */
function buildKeygenEmbed(hwid, days, key) {
    const isLifetime = days === 0;
    const expDateStr = isLifetime ? 'VĨNH VIỄN (Lifetime)' : `${days} NGÀY (Hết hạn: ${new Date(Date.now() + days * 86400000).toLocaleDateString('vi-VN')})`;

    const zaloTemplate = `Chào bạn, Hoàng Bảo gửi bạn mã kích hoạt bản quyền PostHub Pro:
- Mã máy của bạn: ${hwid}
- Gói bản quyền : ${expDateStr}
- Mã kích hoạt  : ${key}

👉 Bạn dán mã vào phần "Kích Hoạt Bản Quyền" trong phần mềm và bấm [KÍCH HOẠT NGAY] là có thể dùng trọn đời/đầy đủ tính năng nhé!`;

    const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🎉 PHÁT HÀNH KEY BẢN QUYỀN POSTHUB PRO')
        .setDescription(`Đã tạo thành công mã kích hoạt bản quyền cho máy khách: **\`${hwid}\`**`)
        .addFields(
            { name: '🖥️ Mã Máy Khách (HWID)', value: `\`${hwid}\``, inline: true },
            { name: '⏳ Gói Bản Quyền', value: `**${expDateStr}**`, inline: true },
            { name: '🔑 MÃ BẢN QUYỀN (LICENSE KEY)', value: `\`\`\`text\n${key}\n\`\`\``, inline: false },
            { name: '📩 Mẫu tin nhắn gửi Zalo cho khách (Chạm sao chép):', value: `\`\`\`text\n${zaloTemplate}\n\`\`\``, inline: false }
        )
        .setFooter({ text: 'Hệ thống bản quyền Hoàng Bảo • PostHub Pro v2.1' })
        .setTimestamp();

    return { embed, key, zaloTemplate };
}

/**
 * Xử lý lệnh !keygen hoặc !key hoặc Slash Command /keygen gửi từ Discord
 */
async function handleDiscordKeygenCommand(target, text, matchedUser) {
    const sendReply = async (payload) => {
        if (target && typeof target.reply === 'function') {
            if (target.replied || target.deferred) {
                return await target.followUp(payload);
            }
            return await target.reply(payload);
        }
    };

    // Chỉ Admin mới có quyền cấp key (phòng ngừa nhân viên tự cấp)
    if (matchedUser && matchedUser.role && matchedUser.role !== 'admin') {
        await sendReply({ content: '⛔ **Quyền bị từ chối:** Chỉ Quản trị viên (Admin - Hoàng Bảo) mới có quyền phát hành License Key!', ephemeral: true });
        return;
    }

    const parts = text.trim().split(/\s+/);
    const rawHwid = parts[1];
    const rawDays = parts[2];

    // 1. Không truyền HWID -> Hiện hướng dẫn chi tiết
    if (!rawHwid) {
        const guideEmbed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('🔑 BỘ CÔNG CỤ CẤP BẢN QUYỀN (HOÀNG BẢO)')
            .setDescription('Tạo License Key bản quyền PostHub Pro trực tiếp từ Discord cho khách hàng của bạn.')
            .addFields(
                {
                    name: '📌 Cú pháp nhanh',
                    value: '`/keygen <hwid> [days]` hoặc `!keygen <Mã_Máy_HWID> [Số_Ngày]`\n*(Ví dụ: `/keygen hwid:HB-F35B-C42E-B236-F7BE days:30`)*'
                },
                {
                    name: '💡 Ví dụ cấp nhanh',
                    value: '• `!keygen HB-F35B-C42E-B236-F7BE 30` ➔ Cấp 30 ngày (1 tháng)\n• `!keygen HB-F35B-C42E-B236-F7BE 0` ➔ Cấp **VĨNH VIỄN (Lifetime)**\n• `!keygen HB-F35B-C42E-B236-F7BE 365` ➔ Cấp 1 năm\n• `!keygen HB-F35B-C42E-B236-F7BE 3` ➔ Cấp dùng thử 3 ngày'
                },
                {
                    name: '⚡ Tùy chọn 1-chạm',
                    value: 'Chỉ cần gõ `!keygen <Mã_Máy>`, Bot sẽ gửi ngay 4 nút bấm để bạn chọn gói thời hạn bằng 1 click chuột!'
                }
            )
            .setFooter({ text: 'Bản quyền Hoàng Bảo • PostHub Pro' });

        await sendReply({ embeds: [guideEmbed] });
        return;
    }

    let hwid = rawHwid.trim().toUpperCase();
    if (!hwid.startsWith('HB-') && !hwid.includes('-')) {
        hwid = 'HB-' + hwid;
    }

    // 2. Chỉ nhập HWID chưa có số ngày -> Hiện 4 nút bấm chọn thời hạn
    if (rawDays === undefined) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`discord_keygen_${hwid}_3`)
                .setLabel('🎁 Dùng thử 3 ngày')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`discord_keygen_${hwid}_30`)
                .setLabel('⭐ 1 Tháng (30 ngày)')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`discord_keygen_${hwid}_365`)
                .setLabel('👑 1 Năm (365 ngày)')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`discord_keygen_${hwid}_0`)
                .setLabel('💎 VĨNH VIỄN (Lifetime)')
                .setStyle(ButtonStyle.Danger)
        );

        const selectEmbed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('⚡ CHỌN THỜI HẠN BẢN QUYỀN CHO KHÁCH')
            .setDescription(`Mã máy khách hàng: **\`${hwid}\`**\n\n👉 Bấm một trong các nút dưới đây để phát hành License Key ngay:`)
            .setFooter({ text: 'Bấm nút để sinh key và mẫu tin nhắn Zalo tức thì' });

        await sendReply({ embeds: [selectEmbed], components: [row] });
        return;
    }

    // 3. Đã nhập đủ HWID và số ngày
    let days = 30;
    const lowerDays = rawDays.toLowerCase();
    if (lowerDays === '0' || lowerDays === 'lifetime' || lowerDays === 'vinhvien' || lowerDays === 'vv') {
        days = 0;
    } else {
        const parsed = parseInt(rawDays, 10);
        days = isNaN(parsed) ? 30 : parsed;
    }

    try {
        const key = generateLicenseKey(hwid, days);
        const { embed } = buildKeygenEmbed(hwid, days, key);
        await sendReply({ embeds: [embed] });
        await dbAsync.log('info', `[Discord Keygen] Admin đã phát hành key cho máy [${hwid}] thời hạn: ${days === 0 ? 'Vĩnh viễn' : days + ' ngày'}.`);
    } catch (err) {
        await sendReply({ content: `❌ **Lỗi khi tạo key:** ${err.message}` });
    }
}

/**
 * Xử lý khi bấm nút chọn thời hạn keygen trên Discord
 */
async function handleDiscordKeygenButton(interaction) {
    const parts = interaction.customId.split('_');
    const hwid = parts[2];
    const days = parseInt(parts[3], 10);

    try {
        const key = generateLicenseKey(hwid, days);
        const { embed } = buildKeygenEmbed(hwid, days, key);
        await interaction.update({
            content: `✅ **ĐÃ PHÁT HÀNH KEY CHO MÁY \`${hwid}\`!**`,
            embeds: [embed],
            components: []
        });
        await dbAsync.log('info', `[Discord Keygen] Admin đã phát hành key bằng nút bấm cho máy [${hwid}] (${days === 0 ? 'Vĩnh viễn' : days + ' ngày'}).`);
    } catch (err) {
        await interaction.reply({ content: `❌ **Lỗi tạo key:** ${err.message}`, ephemeral: true });
    }
}

/**
 * Xây dựng Modal popup tạo Key bản quyền trực tiếp trên Discord
 */
function buildKeygenModal(defaultHwid = '') {
    const modal = new ModalBuilder()
        .setCustomId('discord_modal_keygen')
        .setTitle('🔑 Cấp Key Bản Quyền PostHub Pro');

    const hwidInput = new TextInputBuilder()
        .setCustomId('keygen_hwid')
        .setLabel('Mã Máy Của Khách Hàng (HWID):')
        .setPlaceholder('VD: HB-F35B-C42E-B236-F7BE')
        .setValue(defaultHwid)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32);

    const daysInput = new TextInputBuilder()
        .setCustomId('keygen_days')
        .setLabel('Thời Hạn (Số ngày, gõ 0 = Vĩnh viễn):')
        .setPlaceholder('30 (Gõ 0 nếu cấp Vĩnh viễn, 365 = 1 năm)')
        .setValue('30')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10);

    const row1 = new ActionRowBuilder().addComponents(hwidInput);
    const row2 = new ActionRowBuilder().addComponents(daysInput);

    modal.addComponents(row1, row2);
    return modal;
}

/**
 * Xây dựng Bảng Điều Khiển Bot (Menu chính kèm các nút bấm tương tác)
 */
function buildBotControlPanel(matchedUser) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🤖 BẢNG ĐIỀU KHIỂN POSTHUB PRO (DISCORD BOT)')
        .setDescription(
            `Kênh hoạt động: **#${matchedUser?.display_name || matchedUser?.username || 'PostHub'}**\n` +
            `Dưới đây là các nút thao tác nhanh dành cho bạn:`
        )
        .addFields(
            {
                name: '📝 Đăng Bài Facebook (Up Bài Tự Động)',
                value: 'Gửi nội dung & ảnh/file zip vào kênh này. Bạn có thể bấm nút **[⚡ Xử Lý Đăng Bài Ngay]** bên dưới để bot gửi bài đi duyệt mà không cần đợi đếm ngược.'
            },
            {
                name: '🔑 Phát Hành Bản Quyền (Hoàng Bảo)',
                value: 'Bấm nút **[🔑 Cấp Key Bản Quyền]** để mở form nhập mã máy (HWID) cấp key trực tiếp trên Discord hoặc gõ `!keygen <Mã_Máy>`.'
            }
        )
        .setFooter({ text: 'PostHub Pro • Tự Động Hóa Facebook & Discord Bot v2.1' })
        .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('discord_open_keygen_modal')
            .setLabel('🔑 Cấp Key Bản Quyền')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('discord_trigger_buffer')
            .setLabel('⚡ Xử Lý Đăng Bài Ngay')
            .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('discord_btn_status')
            .setLabel('📊 Trạng Thái Hệ Thống')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('discord_btn_groups')
            .setLabel('👥 Xem Nhóm Facebook')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row1, row2] };
}

/**
 * Kiểm tra quyền riêng tư của Kênh và Người dùng (Chỉ dành riêng cho chủ sở hữu Hoàng Bảo)
 */
async function checkChannelAndUserAccess(channelId, user) {
    if (!channelId || !user) return { allowed: false, reason: 'invalid_params' };

    // 1. Phải là kênh được cài đặt trong Tool Desktop
    if (currentConfig && currentConfig.channelId && channelId !== currentConfig.channelId) {
        return { allowed: false, reason: 'wrong_channel' };
    }

    // 2. Kiểm tra chủ sở hữu độc quyền (Exclusive Owner)
    try {
        const ownerRow = await dbAsync.get(`SELECT value FROM settings WHERE key = 'discord_owner_user_id'`);
        if (ownerRow && ownerRow.value) {
            if (ownerRow.value !== user.id) {
                return {
                    allowed: false,
                    reason: 'not_owner',
                    ownerId: ownerRow.value,
                    error: `⛔ **KÊNH DISCORD NÀY LÀ CỦA RIÊNG HOÀNG BẢO!**\nKênh đã được thiết lập độc quyền cho tài khoản <@${ownerRow.value}>. Người khác không được phép sử dụng.`
                };
            }
        } else {
            // Lần đầu tiên: Tự động ghi nhớ tài khoản này là Chủ Sở Hữu Độc Quyền
            await dbAsync.run(
                `INSERT INTO settings (key, value) VALUES ('discord_owner_user_id', ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                [user.id]
            );
            await dbAsync.log('info', `[Discord] 🔒 ĐÃ TỰ ĐỘNG KHÓA KÊNH ĐỘC QUYỀN cho chủ sở hữu: ${user.tag || user.username} (ID: ${user.id}).`);
        }
    } catch (e) {
        console.error('[Discord] Lỗi checkChannelAndUserAccess:', e);
    }

    return { allowed: true };
}

/**
 * Đăng ký các Slash Commands (/) với Discord REST API
 */
async function registerSlashCommands(client, token) {
    if (!client?.user?.id || !token) return;

    const commands = [
        new SlashCommandBuilder()
            .setName('menu')
            .setDescription('Mở Bảng Điều Khiển PostHub Pro (Up bài, Cấp key, Trạng thái...)'),
        new SlashCommandBuilder()
            .setName('keygen')
            .setDescription('Phát hành License Key bản quyền PostHub Pro cho khách hàng')
            .addStringOption(opt =>
                opt.setName('hwid')
                    .setDescription('Mã máy của khách hàng (VD: HB-F35B-C42E-B236-F7BE)')
                    .setRequired(true)
            )
            .addIntegerOption(opt =>
                opt.setName('days')
                    .setDescription('Số ngày bản quyền (gõ 0 = Vĩnh viễn, 30 = 1 tháng)')
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('upbai')
            .setDescription('Xử lý và đăng bài viết đang chờ gom lên Facebook ngay lập tức'),
        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Kiểm tra trạng thái bot, Chrome Gemini và bài chờ duyệt'),
        new SlashCommandBuilder()
            .setName('groups')
            .setDescription('Xem danh sách các nhóm Facebook đang kích hoạt'),
        new SlashCommandBuilder()
            .setName('lock')
            .setDescription('Khóa độc quyền kênh Discord này cho riêng tài khoản của bạn')
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        // Lấy danh sách tất cả Server (Guild) bot đang tham gia
        let guildsToRegister = [];
        try {
            if (client.guilds && typeof client.guilds.fetch === 'function') {
                const fetched = await client.guilds.fetch();
                guildsToRegister = Array.from(fetched.values());
            } else if (client.guilds?.cache && client.guilds.cache.size > 0) {
                guildsToRegister = Array.from(client.guilds.cache.values());
            }
        } catch (fetchErr) {
            try {
                guildsToRegister = await rest.get(Routes.userGuilds());
            } catch (rErr) {}
        }

        // Đăng ký tức thì cho từng Server (hiện lệnh ngay lập tức không cần đợi 1 tiếng)
        for (const guild of guildsToRegister) {
            const guildId = guild.id;
            const guildName = guild.name || guildId;
            try {
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guildId),
                    { body: commands }
                );
                await dbAsync.log('info', `[Discord] ✓ Đã nạp Slash Commands (/) tức thì cho Server: ${guildName}`);
            } catch (gErr) {
                console.warn(`[Discord] Không thể nạp slash commands cho guild ${guildId}:`, gErr.message);
            }
        }

        // Đăng ký toàn cục (Global)
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        await dbAsync.log('info', `[Discord] ✓ Đã đăng ký Slash Commands (/) toàn cục thành công.`);
    } catch (err) {
        console.error('[Discord] Lỗi đăng ký Slash Commands:', err.message);
    }
}

/**
 * Khởi động Discord Bot
 */
async function startDiscordBot({ token, channelId, debounceSeconds = 60 }) {
    if (!token || !channelId) {
        throw new Error('Vui lòng cung cấp Discord Bot Token và Channel ID');
    }

    if (discordClient) {
        await stopDiscordBot();
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

    currentConfig = { token, channelId, debounceSeconds: parseInt(debounceSeconds, 10) || 60 };

    return new Promise((resolve, reject) => {
        let isResolved = false;

        client.once(Events?.ClientReady || 'clientReady', async () => {
            discordClient = client;
            const botTag = client.user?.tag || 'Discord Bot';
            await dbAsync.log('info', `[Discord Bot] Đã kết nối thành công với tài khoản: ${botTag}! Đang lắng nghe kênh ID: ${channelId}`);
            
            // Kích hoạt đăng ký Slash Commands (/) với Discord
            registerSlashCommands(client, token).catch(e => {
                console.warn('[Discord] Không thể nạp Slash Commands:', e.message);
            });

            if (eventBroadcaster) {
                eventBroadcaster('discord-bot-status', {
                    status: 'connected',
                    botName: botTag,
                    channelId
                });
            }

            if (!isResolved) {
                isResolved = true;
                resolve({ success: true, botName: botTag });
            }
        });

        // Xử lý khi có tin nhắn mới trong kênh
        client.on('messageCreate', async (message) => {
            try {
                // Bỏ qua tin nhắn từ chính bot
                if (message.author.bot) return;

                // Xác thực quyền riêng tư: Kênh độc quyền của riêng Hoàng Bảo
                const access = await checkChannelAndUserAccess(message.channelId, message.author);
                if (!access.allowed) {
                    if (access.reason === 'not_owner') {
                        try { await message.reply(access.error); } catch (e) {}
                    }
                    return;
                }

                // Xác định kênh và người dùng tương ứng (Admin hoặc Nhân viên)
                const matchedUser = await getUserForDiscordChannel(message.channelId);
                if (!matchedUser) return; // Kênh không thuộc quản lý của hệ thống -> Bỏ qua

                const text = message.content ? message.content.trim() : '';
                const { images, zips } = extractMediaAttachments(message);

                // Lệnh kiểm tra trạng thái qua Discord
                if (text.toLowerCase() === '!status' || text.toLowerCase() === '!check') {
                    const activeGroups = await dbAsync.all(
                        `SELECT name FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                        [matchedUser.id]
                    );
                    const pendingPosts = await dbAsync.all(
                        `SELECT id FROM posts WHERE status = 'pending' AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                        [matchedUser.id]
                    );
                    let chromeStatus = { active: false };
                    try {
                        chromeStatus = await isChromeDebuggingActive();
                    } catch (e) {}

                    const statusEmbed = new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('📊 BÁO CÁO HỆ THỐNG POSTHUB TOOL')
                        .setDescription(`Tình trạng hoạt động thời gian thực của Kênh: **#${message.channel.name || 'channel'}**`)
                        .addFields(
                            { name: '👤 Tài khoản kết nối', value: `${matchedUser.display_name || matchedUser.username} (ID: #${matchedUser.id})`, inline: true },
                            { name: '🤖 Chrome Gemini', value: chromeStatus.active ? '🟢 Sẵn sàng' : '🔴 Chưa mở', inline: true },
                            { name: '👥 Nhóm FB Đã Chọn', value: `${activeGroups.length} nhóm`, inline: true },
                            { name: '📝 Bài Chờ Duyệt', value: `${pendingPosts.length} bài`, inline: true },
                            { name: '⏳ Thời Gian Gom', value: `${currentConfig.debounceSeconds} giây`, inline: true },
                            { name: '💻 Tool Desktop', value: '🟢 Đang chạy', inline: true }
                        )
                        .setFooter({ text: 'Gửi nội dung & ảnh hoặc file zip vào kênh này. Bot sẽ gom sau thời gian chờ và gửi nút duyệt!' })
                        .setTimestamp();

                    await message.reply({ embeds: [statusEmbed] });
                    return;
                }

                // Lệnh xem danh sách nhóm FB qua Discord
                if (text.toLowerCase() === '!groups') {
                    const activeGroups = await dbAsync.all(
                        `SELECT name FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                        [matchedUser.id]
                    );
                    if (activeGroups.length === 0) {
                        await message.reply(`⚠️ Hiện chưa có nhóm Facebook nào được kích hoạt cho tài khoản [${matchedUser.username}] trong Tool Desktop. Hãy vào tab "Nhóm Facebook" trên tool để tích chọn!`);
                        return;
                    }
                    const listStr = activeGroups.slice(0, 15).map((g, i) => `${i + 1}. **${g.name}**`).join('\n');
                    const extra = activeGroups.length > 15 ? `\n... và ${activeGroups.length - 15} nhóm khác.` : '';
                    await message.reply(`👥 **Danh sách ${activeGroups.length} nhóm Facebook đang kích hoạt cho tài khoản ${matchedUser.username}:**\n\n${listStr}${extra}`);
                    return;
                }

                // Lệnh mở Menu Bảng Điều Khiển Bot
                const lowerText = text.toLowerCase();
                if (lowerText === '!menu' || lowerText === '!panel' || lowerText === '!help') {
                    await message.reply(buildBotControlPanel(matchedUser));
                    return;
                }

                // Lệnh khóa kênh độc quyền cho tài khoản gửi tin
                if (lowerText === '!lock') {
                    await dbAsync.run(
                        `INSERT INTO settings (key, value) VALUES ('discord_owner_user_id', ?)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                        [message.author.id]
                    );
                    await message.reply(`🔒 **ĐÃ KHÓA KÊNH ĐỘC QUYỀN CHO BẠN (<@${message.author.id}>)!**\nTừ bây giờ bot chỉ phục vụ và nhận lệnh từ riêng tài khoản này. Người khác sẽ bị từ chối tự động.`);
                    return;
                }

                // Lệnh tạo key bản quyền PostHub Pro từ Discord
                if (lowerText === '!keygen' || lowerText.startsWith('!keygen ') || lowerText === '!key' || lowerText.startsWith('!key ')) {
                    await handleDiscordKeygenCommand(message, text, matchedUser);
                    return;
                }

                // Tự động nhận diện khi người dùng dán Mã Máy (HWID) trực tiếp vào kênh
                const trimmedText = text.trim();
                const hwidRegex = /^HB-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/i;
                if (hwidRegex.test(trimmedText)) {
                    await handleDiscordKeygenCommand(message, `!keygen ${trimmedText}`, matchedUser);
                    return;
                }

                if (!text && images.length === 0 && zips.length === 0) return;

                const mediaDetails = [];
                if (images.length > 0) mediaDetails.push(`${images.length} ảnh`);
                if (zips.length > 0) mediaDetails.push(`${zips.length} file zip`);
                const mediaStr = mediaDetails.length > 0 ? ` (${mediaDetails.join(', ')})` : '';

                await dbAsync.log('info', `[Discord Bot] Bắt được tin mới từ ${message.author.tag} (${matchedUser.username} - #${message.channel.name || 'channel'}): ${text ? text.substring(0, 40) + '...' : ''}${mediaStr}`);

                // Thêm phản ứng emoji để người dùng biết bot đã nhận
                try {
                    await message.react('⏳');
                } catch (e) {
                    // Ignore reaction permission errors
                }

                // Quản lý bộ đệm (Debounce) theo từng kênh riêng biệt
                const isFirstMessage = !channelBuffers.has(message.channelId);
                let buffer = channelBuffers.get(message.channelId);
                if (buffer) {
                    clearTimeout(buffer.timer);
                    buffer.userId = matchedUser.id;
                    if (text) buffer.texts.push(text);
                    if (images.length > 0) buffer.images.push(...images);
                    if (zips.length > 0) buffer.zips.push(...zips);
                } else {
                    buffer = {
                        channel: message.channel,
                        userId: matchedUser.id,
                        username: message.member?.displayName || message.author.username,
                        userTag: message.author.tag,
                        texts: text ? [text] : [],
                        images: [...images],
                        zips: [...zips]
                    };
                    channelBuffers.set(message.channelId, buffer);
                }

                // Nếu là tin nhắn đầu tiên của đợt gom, gửi thông báo kèm nút bấm "Xử lý đăng ngay"
                if (isFirstMessage) {
                    try {
                        const quickRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('discord_trigger_buffer')
                                .setLabel('⚡ Xử Lý Đăng Bài Ngay')
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId('discord_open_keygen_modal')
                                .setLabel('🔑 Cấp Key Khách')
                                .setStyle(ButtonStyle.Secondary)
                        );
                        await message.reply({
                            content: `⏳ **Đang gom tin bài đăng (${mediaDetails.length > 0 ? mediaDetails.join(', ') : 'văn bản'})!** Tự động gom thêm trong ${currentConfig.debounceSeconds}s...\n👉 Hoặc bấm **[⚡ Xử Lý Đăng Bài Ngay]** nếu bạn đã gửi xong:`,
                            components: [quickRow]
                        });
                    } catch (e) {
                        // Ignore reply errors
                    }
                }

                const debounceMs = currentConfig.debounceSeconds * 1000;
                buffer.timer = setTimeout(async () => {
                    await processDiscordBuffer(message.channelId);
                }, debounceMs);

            } catch (err) {
                console.error('[Discord] Lỗi xử lý messageCreate:', err);
            }
        });

        // Xử lý khi người dùng tương tác trên Discord (Slash Commands, Select Menu, Nút bấm, Modal)
        client.on('interactionCreate', async (interaction) => {
            // Bỏ qua nếu từ bot
            if (interaction.user.bot) return;

            // Xác thực quyền riêng tư: Kênh độc quyền của riêng Hoàng Bảo
            const access = await checkChannelAndUserAccess(interaction.channelId, interaction.user);
            if (!access.allowed) {
                if (access.reason === 'not_owner') {
                    await interaction.reply({ content: access.error, ephemeral: true });
                }
                return;
            }

            // Xử lý Slash Commands (/)
            if (interaction.isChatInputCommand()) {
                const matchedUser = await getUserForDiscordChannel(interaction.channelId);
                const cmd = interaction.commandName;

                if (cmd === 'menu') {
                    await interaction.reply(buildBotControlPanel(matchedUser));
                    return;
                }

                if (cmd === 'keygen') {
                    const hwid = interaction.options.getString('hwid');
                    const days = interaction.options.getInteger('days');
                    const daysParam = days !== null && days !== undefined ? ` ${days}` : '';
                    await handleDiscordKeygenCommand(interaction, `!keygen ${hwid}${daysParam}`, matchedUser);
                    return;
                }

                if (cmd === 'upbai') {
                    const buffer = channelBuffers.get(interaction.channelId);
                    if (!buffer || (buffer.texts.length === 0 && buffer.images.length === 0 && buffer.zips.length === 0)) {
                        await interaction.reply({
                            content: '⚠️ Hiện tại kênh chưa có bài viết nào đang trong hàng chờ gom! Bạn hãy gửi nội dung hoặc ảnh/zip vào kênh trước nhé.',
                            ephemeral: true
                        });
                        return;
                    }
                    clearTimeout(buffer.timer);
                    await interaction.reply({
                        content: '⚡ **Đã nhận lệnh Slash Command `/upbai`! Đang tiến hành xử lý lưu ảnh và gửi sang Gemini AI biên tập ngay...**'
                    });
                    await processDiscordBuffer(interaction.channelId);
                    return;
                }

                if (cmd === 'status') {
                    const activeGroups = await dbAsync.all(
                        `SELECT name FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                        [matchedUser.id]
                    );
                    const pendingPosts = await dbAsync.all(
                        `SELECT id FROM posts WHERE status = 'pending' AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                        [matchedUser.id]
                    );
                    let chromeStatus = { active: false };
                    try { chromeStatus = await isChromeDebuggingActive(); } catch (e) {}

                    const statusEmbed = new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('📊 BÁO CÁO HỆ THỐNG POSTHUB TOOL')
                        .setDescription(`Tình trạng hoạt động thời gian thực của Kênh: **#${interaction.channel.name || 'channel'}**`)
                        .addFields(
                            { name: '👤 Tài khoản', value: `${matchedUser.display_name || matchedUser.username}`, inline: true },
                            { name: '🤖 Chrome Gemini', value: chromeStatus.active ? '🟢 Sẵn sàng' : '🔴 Chưa mở', inline: true },
                            { name: '👥 Nhóm FB Đã Chọn', value: `${activeGroups.length} nhóm`, inline: true },
                            { name: '📝 Bài Chờ Duyệt', value: `${pendingPosts.length} bài`, inline: true },
                            { name: '💻 Tool Desktop', value: '🟢 Đang chạy', inline: true }
                        )
                        .setFooter({ text: 'Gõ /menu hoặc gửi bài viết để bắt đầu.' })
                        .setTimestamp();

                    await interaction.reply({ embeds: [statusEmbed], ephemeral: true });
                    return;
                }

                if (cmd === 'groups') {
                    const activeGroups = await dbAsync.all(
                        `SELECT name FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                        [matchedUser.id]
                    );
                    if (activeGroups.length === 0) {
                        await interaction.reply({
                            content: `⚠️ Hiện chưa có nhóm Facebook nào được kích hoạt cho tài khoản [${matchedUser.username}] trong Tool Desktop. Hãy vào tab "Nhóm Facebook" trên tool để tích chọn!`,
                            ephemeral: true
                        });
                    } else {
                        const listStr = activeGroups.slice(0, 15).map((g, i) => `${i + 1}. **${g.name}**`).join('\n');
                        const extra = activeGroups.length > 15 ? `\n... và ${activeGroups.length - 15} nhóm khác.` : '';
                        await interaction.reply({
                            content: `👥 **Danh sách ${activeGroups.length} nhóm Facebook đang kích hoạt cho tài khoản ${matchedUser.username}:**\n\n${listStr}${extra}`,
                            ephemeral: true
                        });
                    }
                    return;
                }

                if (cmd === 'lock') {
                    await dbAsync.run(
                        `INSERT INTO settings (key, value) VALUES ('discord_owner_user_id', ?)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                        [interaction.user.id]
                    );
                    await interaction.reply({
                        content: `🔒 **ĐÃ KHÓA KÊNH ĐỘC QUYỀN CHO BẠN (<@${interaction.user.id}>)!**\nTừ bây giờ bot chỉ phục vụ và nhận lệnh từ riêng tài khoản này. Mọi người khác sẽ bị từ chối tự động.`,
                        ephemeral: false
                    });
                    return;
                }
            }

            // Xác định kênh và người dùng tương ứng (Admin hoặc Nhân viên)
            const matchedUser = await getUserForDiscordChannel(interaction.channelId);
            if (!matchedUser) return; // Không thuộc kênh quản lý -> Bỏ qua

            // Helper an toàn để tránh xung đột double-click trên Discord API
            const safeDeferUpdate = async () => {
                try {
                    if (!interaction.deferred && !interaction.replied) {
                        await interaction.deferUpdate();
                    }
                } catch (e) {}
            };

            // A. XỬ LÝ CHỌN NHÓM TỪ SELECT MENU -> HIỂN THỊ EMBED KIỂM TRA LẠI (CONFIRM REVIEW)
            if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('discord_select_cluster_') || interaction.customId.startsWith('discord_select_target_'))) {
                const rawId = interaction.customId.replace('discord_select_cluster_', '').replace('discord_select_target_', '');
                const postId = parseInt(rawId, 10);
                const selectedVal = interaction.values[0];
                await safeDeferUpdate();

                const clusterId = parseInt(selectedVal.replace('target_cluster_', '').replace('cluster_', ''), 10);
                const clusterDetails = await dbAsync.getClusterDetails(clusterId);
                const targetLabel = clusterDetails?.name ? clusterDetails.name : `Nhóm #${clusterId}`;
                const groups = clusterDetails?.groups || [];
                const targetParam = clusterId;

                if (groups.length === 0) {
                    const backRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`discord_choose_cluster_${postId}`)
                            .setLabel('🔙 Chọn Nhóm Khác')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`discord_reject_${postId}`)
                            .setLabel('❌ Hủy bài')
                            .setStyle(ButtonStyle.Danger)
                    );
                    await interaction.editReply({
                        content: `⚠️ **Nhóm [${targetLabel}] hiện chưa có group Facebook nào được gán!**\nVui lòng vào Tool Desktop gán các group cho nhóm này, hoặc chọn nhóm khác:`,
                        components: [backRow]
                    });
                    return;
                }

                // Lấy thông tin bài viết để hiển thị xem trước trước khi bấm ACP
                const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postId]);
                let imgCount = 0;
                try {
                    const parsedImgs = JSON.parse(post?.images || '[]');
                    imgCount = Array.isArray(parsedImgs) ? parsedImgs.length : 0;
                } catch (e) {
                    imgCount = 0;
                }

                const postPreview = (post?.rewritten_text || post?.original_text || '(Chưa có nội dung)').substring(0, 300);
                const dots = (post?.rewritten_text || post?.original_text || '').length > 300 ? '...' : '';

                // Hiển thị danh sách nhóm và nút [Xác Nhận Đăng (ACP)]
                const groupListStr = groups.slice(0, 20).map((g, idx) => `${idx + 1}. **${g.name}**`).join('\n');
                const extraStr = groups.length > 20 ? `\n... và ${groups.length - 20} group khác nữa.` : '';

                const confirmEmbed = new EmbedBuilder()
                    .setColor(0x00b894)
                    .setTitle(`🎯 KIỂM TRA & XÁC NHẬN ĐĂNG BÀI #${postId}`)
                    .setDescription(
                        `Vui lòng kiểm tra kỹ danh sách các group và nội dung trước khi duyệt đăng:\n\n` +
                        `📁 **Nhóm đã chọn:** **${targetLabel}**\n` +
                        `👥 **Tổng số group Facebook:** **${groups.length} group**\n` +
                        `🖼️ **Hình ảnh đính kèm:** **${imgCount} ảnh**\n\n` +
                        `📋 **Danh sách các group sẽ đăng:**\n${groupListStr}${extraStr}\n\n` +
                        `📝 **Xem trước nội dung:**\n>>> ${postPreview}${dots}`
                    )
                    .setFooter({ text: 'Kiểm tra kỹ thông tin trên. Bấm [🚀 Xác Nhận Đăng (ACP)] để bắt đầu đăng ngay!' });

                const confirmButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`discord_acp_${postId}_${targetParam}`)
                        .setLabel('🚀 Xác Nhận Đăng (ACP)')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`discord_choose_cluster_${postId}`)
                        .setLabel('🔙 Chọn Nhóm Khác')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`discord_reject_${postId}`)
                        .setLabel('❌ Hủy bỏ')
                        .setStyle(ButtonStyle.Danger)
                );

                await interaction.editReply({
                    content: `👉 **Đã chọn nhóm [${targetLabel}]! Vui lòng kiểm tra lại lượt cuối rồi bấm [Xác Nhận Đăng (ACP)]:**`,
                    embeds: [confirmEmbed],
                    components: [confirmButtons]
                });
                return;
            }

            if (!interaction.isButton()) return;
            const customId = interaction.customId;

            // B1. Bấm NÚT XÁC NHẬN (chọn nhóm bao gồm các group đã chọn sẵn)
            if (customId.startsWith('discord_choose_cluster_') || customId.startsWith('discord_approve_')) {
                const idPart = customId.replace('discord_choose_cluster_', '').replace('discord_approve_', '');
                const postId = parseInt(idPart, 10);
                await safeDeferUpdate();

                // Lấy thông tin bài viết để biết user_id sở hữu
                const post = await dbAsync.get(`SELECT user_id FROM posts WHERE id = ?`, [postId]);
                const effectiveUserId = post?.user_id || matchedUser.id || 1;

                // Lấy danh sách cụm nhóm được phân quyền cho user này
                const clusters = await dbAsync.getClusters(effectiveUserId);

                // Nếu chưa setting nhóm nào trong tool -> Không hiện danh sách chọn, thông báo người dùng vào setting
                if (!clusters || clusters.length === 0) {
                    const noSettingRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`discord_cancel_select_${postId}`)
                            .setLabel('🔙 Quay lại')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`discord_reject_${postId}`)
                            .setLabel('❌ Hủy bỏ')
                            .setStyle(ButtonStyle.Danger)
                    );
                    await interaction.editReply({
                        content: `⚠️ **Bạn chưa cài đặt (setting) nhóm nào trong Tool Desktop!**\n\n📌 *Mỗi nhóm trên bot sẽ bao gồm các group Facebook bạn chọn sẵn.* Hiện tại tài khoản của bạn chưa tạo nhóm nào.\n👉 Vui lòng mở Tool Desktop ➔ vào tab **"Quản Lý Nhóm FB"** ➔ bấm **"Tạo Cụm / Nhóm Mới"** để đặt tên nhóm và chọn sẵn các group Facebook trước khi duyệt đăng bài!`,
                        embeds: [],
                        components: [noSettingRow]
                    });
                    return;
                }

                // Đã có nhóm được setting -> Trong danh sách chỉ hiện các nhóm này
                const options = clusters.slice(0, 25).map(c => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`${c.name}`.slice(0, 100))
                        .setDescription(`Bao gồm ${c.group_count || 0} group Facebook đã chọn sẵn`.slice(0, 100))
                        .setValue(`target_cluster_${c.id}`)
                        .setEmoji('📁')
                );

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`discord_select_target_${postId}`)
                    .setPlaceholder('🎯 Chọn Nhóm bạn muốn đăng...')
                    .addOptions(options);

                const menuRow = new ActionRowBuilder().addComponents(selectMenu);
                const cancelRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`discord_cancel_select_${postId}`)
                        .setLabel('🔙 Quay lại')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`discord_reject_${postId}`)
                        .setLabel('❌ Hủy bỏ')
                        .setStyle(ButtonStyle.Danger)
                );

                await interaction.editReply({
                    content: `🎯 **Vui lòng chọn Nhóm để đăng bài #${postId}:**\n*(Mỗi nhóm dưới đây gồm các group Facebook bạn đã chọn sẵn trong Tool. Sau khi chọn sẽ có bước kiểm tra lại trước khi up bài)*`,
                    embeds: [],
                    components: [menuRow, cancelRow]
                });
                return;
            }

            // B2. Bấm NÚT QUAY LẠI TỪ BƯỚC CHỌN NHÓM
            if (customId.startsWith('discord_cancel_select_')) {
                const postId = parseInt(customId.replace('discord_cancel_select_', ''), 10);
                await safeDeferUpdate();
                await interaction.editReply({
                    content: `✨ **Bài viết #${postId} đã sẵn sàng!** Vui lòng kiểm tra và bấm nút bên dưới:`,
                    embeds: [],
                    components: [createApprovalButtons(postId, false)]
                });
                return;
            }

            // B3. Bấm NÚT XÁC NHẬN ĐĂNG (ACP) SAU KHI ĐÃ CHECK QUA
            if (customId.startsWith('discord_acp_')) {
                // customId format: discord_acp_${postId}_${targetParam}
                const parts = customId.split('_');
                const postId = parseInt(parts[2], 10);
                const targetParam = parts.slice(3).join('_');
                await safeDeferUpdate();

                const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postId]);
                const effectiveUserId = post?.user_id || matchedUser.id || 1;

                const clusterId = parseInt(targetParam, 10);
                const targetClusterDbId = isNaN(clusterId) ? null : clusterId;
                const c = await dbAsync.get(`SELECT name FROM fb_clusters WHERE id = ?`, [clusterId]);
                const targetLabel = c ? c.name : (targetParam === 'all' ? 'Tất cả nhóm' : `Nhóm #${targetParam}`);

                await dbAsync.log('info', `[Discord] Người dùng #${effectiveUserId} (${matchedUser.username}) đã xác nhận (ACP) đăng bài #${postId} vào Nhóm [${targetLabel}]!`);

                // Vô hiệu hóa nút và thông báo đang tiến hành đăng
                await interaction.editReply({
                    content: `🚀 **ĐÃ XÁC NHẬN (ACP) BÀI #${postId}!**\nTool đang tiến hành đăng rải rác lộn xộn vào các group thuộc **Nhóm [${targetLabel}]**...`,
                    embeds: [],
                    components: []
                });

                // Cập nhật trạng thái post
                await dbAsync.run(`UPDATE posts SET status = 'approved', target_cluster_id = ? WHERE id = ?`, [targetClusterDbId, postId]);

                // Bắt đầu đăng bài theo phiên của đúng người dùng này
                try {
                    const result = await publishPostForUser(effectiveUserId, postId, targetParam);
                    if (result?.success) {
                        notifiedInteractionPostIds.add(postId);
                        setTimeout(() => notifiedInteractionPostIds.delete(postId), 30000);

                        const postedGroups = result.groups || [];
                        const failedGroups = result.failed || [];
                        const embed = buildPublishResultEmbed(postId, targetLabel, postedGroups, failedGroups);

                        await interaction.followUp({
                            embeds: [embed],
                            ephemeral: false
                        });
                    } else {
                        const errMsg = result?.stopped ? 'Quá trình đăng bài đã bị Dừng Khẩn Cấp từ Tool Desktop.' : (result?.error || 'Đăng bài không thành công hoặc không tìm thấy nhóm khả dụng.');
                        await dbAsync.log('warn', `[Discord] Đăng bài #${postId} không hoàn thành: ${errMsg}`);
                        await interaction.followUp({
                            content: `⚠️ **Không thể hoàn tất đăng bài #${postId}:** ${errMsg}`,
                            ephemeral: false
                        });
                    }
                } catch (pubErr) {
                    await dbAsync.log('error', `[Discord] Lỗi khi đăng bài #${postId} vào ${targetLabel}: ${pubErr.message}`);
                    await interaction.followUp({
                        content: `⚠️ **Gặp lỗi khi đăng bài #${postId}:** ${pubErr.message}`,
                        ephemeral: false
                    });
                }
                return;
            }

            // 2. Bấm NÚT VIẾT LẠI AI
            if (customId.startsWith('discord_rewrite_')) {
                const postId = parseInt(customId.replace('discord_rewrite_', ''), 10);
                await safeDeferUpdate();

                await interaction.editReply({
                    content: `🔄 **Đang gửi bài #${postId} vào Gemini Web để viết phiên bản khác...** Vui lòng đợi trong giây lát...`,
                    components: [createApprovalButtons(postId, true)]
                });

                try {
                    const post = await dbAsync.get(`SELECT * FROM posts WHERE id = ?`, [postId]);
                    if (!post) throw new Error('Không tìm thấy bài viết');

                    const newRewritten = await rewriteWithGemini(post.original_text, interaction.user.username, 'Discord Rewrite');
                    await dbAsync.run(`UPDATE posts SET rewritten_text = ? WHERE id = ?`, [newRewritten, postId]);

                    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                        .setDescription(newRewritten.length > 4000 ? newRewritten.substring(0, 3995) + '...' : newRewritten)
                        .setFooter({ text: 'Đã viết lại phiên bản mới! Bấm nút bên dưới để Duyệt bài.' });

                    await interaction.editReply({
                        content: `✨ **Đã viết lại xong bài #${postId}!** Vui lòng kiểm tra phiên bản mới:`,
                        embeds: [updatedEmbed],
                        components: [createApprovalButtons(postId, false)]
                    });

                    await dbAsync.log('info', `[Discord] Đã viết lại thành công bài #${postId} theo yêu cầu.`);
                } catch (rwErr) {
                    await interaction.editReply({
                        content: `⚠️ Viết lại thất bại: ${rwErr.message}`,
                        components: [createApprovalButtons(postId, false)]
                    });
                }
                return;
            }

            // 3. Bấm NÚT HỦY BỎ
            if (customId.startsWith('discord_reject_')) {
                const postId = parseInt(customId.replace('discord_reject_', ''), 10);
                await safeDeferUpdate();

                await dbAsync.run(`UPDATE posts SET status = 'rejected' WHERE id = ?`, [postId]);
                await interaction.editReply({
                    content: `❌ **ĐÃ HỦY BÀI VIẾT #${postId}.** Bài viết này sẽ không được đăng lên Facebook.`,
                    components: []
                });

                await dbAsync.log('info', `[Discord] Bạn đã hủy bài đăng #${postId} từ Discord.`);
                return;
            }

            // 4. Bấm NÚT XEM NHÓM FB
            if (customId.startsWith('discord_groups_')) {
                const postId = parseInt(customId.replace('discord_groups_', ''), 10);
                const post = await dbAsync.get(`SELECT user_id FROM posts WHERE id = ?`, [postId]);
                const effectiveUserId = post?.user_id || matchedUser.id || 1;
                const activeFbGroups = await dbAsync.all(
                    `SELECT name FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                    [effectiveUserId]
                );
                if (activeFbGroups.length === 0) {
                    await interaction.reply({
                        content: '⚠️ Hiện tại chưa có nhóm Facebook nào được kích hoạt để đăng bài trong Tool Desktop.',
                        ephemeral: true
                    });
                } else {
                    const listStr = activeFbGroups.slice(0, 15).map((g, i) => `${i + 1}. **${g.name}**`).join('\n');
                    const extraStr = activeFbGroups.length > 15 ? `\n... và ${activeFbGroups.length - 15} nhóm khác.` : '';
                    await interaction.reply({
                        content: `👥 **Danh sách ${activeFbGroups.length} nhóm Facebook sẽ nhận bài đăng này:**\n\n${listStr}${extraStr}`,
                        ephemeral: true
                    });
                }
                return;
            }

            // 5. Bấm NÚT TẠO KEY BẢN QUYỀN (1-Chạm)
            if (interaction.isButton() && interaction.customId.startsWith('discord_keygen_')) {
                await handleDiscordKeygenButton(interaction);
                return;
            }

            // 6. Bấm NÚT MỞ MODAL NHẬP HWID CẤP KEY
            if (interaction.isButton() && interaction.customId === 'discord_open_keygen_modal') {
                if (matchedUser && matchedUser.role && matchedUser.role !== 'admin') {
                    await interaction.reply({
                        content: '⛔ **Quyền bị từ chối:** Chỉ Quản trị viên (Hoàng Bảo) mới có quyền phát hành License Key!',
                        ephemeral: true
                    });
                    return;
                }
                const modal = buildKeygenModal();
                await interaction.showModal(modal);
                return;
            }

            // 7. Xử lý khi SUBMIT MODAL CẤP KEY BẢN QUYỀN
            if (interaction.isModalSubmit() && interaction.customId === 'discord_modal_keygen') {
                const rawHwid = interaction.fields.getTextInputValue('keygen_hwid') || '';
                const rawDays = interaction.fields.getTextInputValue('keygen_days') || '30';

                let hwid = rawHwid.trim().toUpperCase();
                if (!hwid.startsWith('HB-') && !hwid.includes('-')) {
                    hwid = 'HB-' + hwid;
                }

                let days = 30;
                const lowerDays = rawDays.toLowerCase().trim();
                if (lowerDays === '0' || lowerDays === 'lifetime' || lowerDays === 'vinhvien' || lowerDays === 'vv') {
                    days = 0;
                } else {
                    const parsed = parseInt(rawDays, 10);
                    days = isNaN(parsed) ? 30 : parsed;
                }

                try {
                    const key = generateLicenseKey(hwid, days);
                    const { embed } = buildKeygenEmbed(hwid, days, key);
                    await interaction.reply({
                        content: `🎉 **ĐÃ PHÁT HÀNH KEY BẢN QUYỀN THÀNH CÔNG CHO KHÁCH!**`,
                        embeds: [embed]
                    });
                    await dbAsync.log('info', `[Discord Modal Keygen] Admin đã phát hành key cho máy [${hwid}] (${days === 0 ? 'Vĩnh viễn' : days + ' ngày'}).`);
                } catch (err) {
                    await interaction.reply({ content: `❌ **Lỗi tạo key:** ${err.message}`, ephemeral: true });
                }
                return;
            }

            // 8. Bấm NÚT XỬ LÝ & ĐĂNG BÀI NGAY (Bỏ qua thời gian chờ gom tin 60s)
            if (interaction.isButton() && interaction.customId === 'discord_trigger_buffer') {
                const buffer = channelBuffers.get(interaction.channelId);
                if (!buffer || (buffer.texts.length === 0 && buffer.images.length === 0 && buffer.zips.length === 0)) {
                    await interaction.reply({
                        content: '⚠️ Hiện tại kênh chưa có bài viết nào đang trong hàng chờ gom! Bạn hãy gửi nội dung hoặc ảnh/zip vào kênh trước nhé.',
                        ephemeral: true
                    });
                    return;
                }
                clearTimeout(buffer.timer);
                await interaction.reply({
                    content: '⚡ **Đã nhận lệnh! Đang tiến hành xử lý lưu ảnh và gửi sang Gemini AI biên tập ngay...**'
                });
                await processDiscordBuffer(interaction.channelId);
                return;
            }

            // 9. Bấm NÚT XEM TRẠNG THÁI HỆ THỐNG
            if (interaction.isButton() && interaction.customId === 'discord_btn_status') {
                const activeGroups = await dbAsync.all(
                    `SELECT name FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                    [matchedUser.id]
                );
                const pendingPosts = await dbAsync.all(
                    `SELECT id FROM posts WHERE status = 'pending' AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                    [matchedUser.id]
                );
                let chromeStatus = { active: false };
                try { chromeStatus = await isChromeDebuggingActive(); } catch (e) {}

                const statusEmbed = new EmbedBuilder()
                    .setColor(0x5865f2)
                    .setTitle('📊 BÁO CÁO HỆ THỐNG POSTHUB TOOL')
                    .setDescription(`Tình trạng hoạt động thời gian thực của Kênh: **#${interaction.channel.name || 'channel'}**`)
                    .addFields(
                        { name: '👤 Tài khoản', value: `${matchedUser.display_name || matchedUser.username}`, inline: true },
                        { name: '🤖 Chrome Gemini', value: chromeStatus.active ? '🟢 Sẵn sàng' : '🔴 Chưa mở', inline: true },
                        { name: '👥 Nhóm FB Đã Chọn', value: `${activeGroups.length} nhóm`, inline: true },
                        { name: '📝 Bài Chờ Duyệt', value: `${pendingPosts.length} bài`, inline: true },
                        { name: '💻 Tool Desktop', value: '🟢 Đang chạy', inline: true }
                    )
                    .setFooter({ text: 'Bấm [⚡ Xử Lý Đăng Bài Ngay] hoặc gửi bài viết để bắt đầu.' })
                    .setTimestamp();

                await interaction.reply({ embeds: [statusEmbed], ephemeral: true });
                return;
            }

            // 10. Bấm NÚT XEM DANH SÁCH NHÓM FACEBOOK
            if (interaction.isButton() && interaction.customId === 'discord_btn_groups') {
                const activeGroups = await dbAsync.all(
                    `SELECT name FROM fb_groups WHERE is_active = 1 AND (user_id = ? OR user_id = 1 OR user_id IS NULL)`,
                    [matchedUser.id]
                );
                if (activeGroups.length === 0) {
                    await interaction.reply({
                        content: `⚠️ Hiện chưa có nhóm Facebook nào được kích hoạt cho tài khoản [${matchedUser.username}] trong Tool Desktop. Hãy vào tab "Nhóm Facebook" trên tool để tích chọn!`,
                        ephemeral: true
                    });
                } else {
                    const listStr = activeGroups.slice(0, 15).map((g, i) => `${i + 1}. **${g.name}**`).join('\n');
                    const extra = activeGroups.length > 15 ? `\n... và ${activeGroups.length - 15} nhóm khác.` : '';
                    await interaction.reply({
                        content: `👥 **Danh sách ${activeGroups.length} nhóm Facebook đang kích hoạt cho tài khoản ${matchedUser.username}:**\n\n${listStr}${extra}`,
                        ephemeral: true
                    });
                }
                return;
            }
        });

        client.on('error', async (err) => {
            console.error('[Discord Client Error]:', err);
            await dbAsync.log('error', `[Discord Bot Error]: ${err.message}`);
        });

        // Đăng nhập bot
        client.login(token).catch(err => {
            if (!isResolved) {
                isResolved = true;
                reject(new Error(`Không thể đăng nhập Discord Bot: ${err.message}`));
            }
        });
    });
}

/**
 * Gửi tin nhắn kiểm tra kết nối vào kênh Discord
 */
async function sendDiscordTestMessage(customText) {
    if (!discordClient || !discordClient.isReady()) {
        throw new Error('Bot Discord chưa kết nối hoặc chưa online.');
    }
    const chId = currentConfig?.channelId;
    if (!chId) throw new Error('Chưa cấu hình Channel ID.');
    const ch = await discordClient.channels.fetch(chId);
    if (!ch) throw new Error(`Không tìm thấy kênh với ID: ${chId}`);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🔔 Kiểm Tra Kết Nối PostHub Tool')
        .setDescription(customText || '✅ **Bot Discord đã kết nối thành công với Tool Desktop!**\nSẵn sàng nhận bài viết và hình ảnh phòng trọ để biên tập bằng Gemini Web.')
        .addFields(
            { name: 'Thời gian chờ gom bài', value: `${currentConfig?.debounceSeconds || 60} giây`, inline: true },
            { name: 'Trạng thái Bot', value: '🟢 Online & Sẵn sàng', inline: true }
        )
        .setTimestamp();

    await ch.send({ embeds: [embed] });
    return { success: true };
}

/**
 * Dừng Discord Bot
 */
async function stopDiscordBot() {
    if (discordClient) {
        try {
            await discordClient.destroy();
        } catch (e) {
            console.error('[Discord] Lỗi khi destroy client:', e);
        }
        discordClient = null;
        await dbAsync.log('info', `[Discord Bot] Đã ngắt kết nối.`);
        if (eventBroadcaster) {
            eventBroadcaster('discord-bot-status', { status: 'disconnected' });
        }
    }
    // Xóa toàn bộ bộ đệm chờ nếu có
    for (const [chId, buf] of channelBuffers.entries()) {
        if (buf.timer) clearTimeout(buf.timer);
    }
    channelBuffers.clear();
}

/**
 * Lấy trạng thái hiện tại của Discord Bot
 */
function getDiscordBotStatus() {
    return {
        isConnected: !!(discordClient && discordClient.isReady()),
        botName: discordClient?.user?.tag || null,
        channelId: currentConfig?.channelId || null,
        debounceSeconds: currentConfig?.debounceSeconds || 60,
        pendingChannels: channelBuffers.size
    };
}

module.exports = {
    startDiscordBot,
    stopDiscordBot,
    getDiscordBotStatus,
    setDiscordEventBroadcaster,
    sendDiscordTestMessage,
    processDiscordBuffer,
    extractMediaAttachments,
    extractImageUrls,
    extractImagesFromDiscordZips,
    downloadAndSaveDiscordImages,
    getEffectiveImagesDir,
    getUserForDiscordChannel,
    buildPublishResultEmbed,
    notifyDiscordPostResult,
    buildKeygenEmbed,
    handleDiscordKeygenCommand,
    handleDiscordKeygenButton,
    buildBotControlPanel,
    buildKeygenModal,
    checkChannelAndUserAccess,
    registerSlashCommands
};
