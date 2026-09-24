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
    StringSelectMenuOptionBuilder
} = require('discord.js');
const { dbAsync } = require('../db');
const { rewriteWithGemini } = require('./gemini');
const { publishPost } = require('./fbEngine');
const { isChromeDebuggingActive } = require('./chromeGemini');

let discordClient = null;
let currentConfig = null;
let eventBroadcaster = null;

// Thư mục lưu trữ ảnh cục bộ từ Discord
const imagesDir = path.join(__dirname, '..', '..', 'data', 'images');
if (!fs.existsSync(imagesDir)) {
    try {
        fs.mkdirSync(imagesDir, { recursive: true });
    } catch (e) {
        console.error('[DiscordEngine] Không thể tạo thư mục lưu ảnh:', e.message);
    }
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
    if (!fs.existsSync(imagesDir)) {
        try { fs.mkdirSync(imagesDir, { recursive: true }); } catch (e) {}
    }

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
    if (!fs.existsSync(imagesDir)) {
        try { fs.mkdirSync(imagesDir, { recursive: true }); } catch (e) {}
    }
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

/**
 * Tạo giao diện nút bấm duyệt bài cho Discord
 */
function createApprovalButtons(postId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`discord_choose_cluster_${postId}`)
            .setLabel('✅ Duyệt Theo Cụm')
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

    const { channel, texts, images, zips = [], username, userTag } = buffer;
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

    await dbAsync.log('info', `[Discord Bot] Đã hết thời gian chờ gom. Bắt đầu xử lý bài đăng từ ${userTag} (${combinedText.length} ký tự, ${mediaDescStr})...`);

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
            [`Discord: #${channel.name || 'channel'}`, userTag || username, combinedText, JSON.stringify(allLocalImages)]
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

    // 3. Lấy danh sách nhóm Facebook đang bật để chuẩn bị
    const activeFbGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);
    const targetFbStr = activeFbGroups.map(g => g.name).join(', ') || 'Tất cả nhóm đã chọn';

    // 4. Lưu bài viết vào bảng posts (trạng thái pending)
    let postRecord = null;
    try {
        postRecord = await dbAsync.run(
            `INSERT INTO posts (message_id, group_name, original_text, rewritten_text, target_fb_group, status, images) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [msgRecord?.id || null, `Discord: #${channel.name || 'channel'}`, combinedText, rewritten, targetFbStr, 'pending', JSON.stringify(allLocalImages)]
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
            .setFooter({ text: 'Kiểm tra nội dung phía trên. Bấm [✅ Duyệt Theo Cụm] bên dưới để chọn cụm nhóm và đăng!' })
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

        client.once('ready', async () => {
            discordClient = client;
            const botTag = client.user?.tag || 'Discord Bot';
            await dbAsync.log('info', `[Discord Bot] Đã kết nối thành công với tài khoản: ${botTag}! Đang lắng nghe kênh ID: ${channelId}`);
            
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

                // Chỉ lắng nghe đúng kênh chỉ định
                if (message.channelId !== currentConfig.channelId) return;

                const text = message.content ? message.content.trim() : '';
                const { images, zips } = extractMediaAttachments(message);

                // Lệnh kiểm tra trạng thái qua Discord
                if (text.toLowerCase() === '!status' || text.toLowerCase() === '!check') {
                    const activeGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);
                    const pendingPosts = await dbAsync.all(`SELECT id FROM posts WHERE status = 'pending'`);
                    let chromeStatus = { active: false };
                    try {
                        chromeStatus = await isChromeDebuggingActive();
                    } catch (e) {}

                    const statusEmbed = new EmbedBuilder()
                        .setColor(0x5865f2)
                        .setTitle('📊 BÁO CÁO HỆ THỐNG POSTHUB TOOL')
                        .setDescription('Tình trạng hoạt động thời gian thực của Tool Desktop kết nối với Discord:')
                        .addFields(
                            { name: '🤖 Chrome Gemini', value: chromeStatus.active ? '🟢 Sẵn sàng' : '🔴 Chưa mở', inline: true },
                            { name: '👥 Nhóm FB Đã Chọn', value: `${activeGroups.length} nhóm`, inline: true },
                            { name: '📝 Bài Chờ Duyệt', value: `${pendingPosts.length} bài`, inline: true },
                            { name: '⏳ Thời Gian Gom', value: `${currentConfig.debounceSeconds} giây`, inline: true },
                            { name: '💻 Tool Desktop', value: '🟢 Đang chạy', inline: true }
                        )
                        .setFooter({ text: 'Gửi nội dung & ảnh hoặc file zip vào kênh này. Bot sẽ gom sau 1 phút và gửi nút duyệt!' })
                        .setTimestamp();

                    await message.reply({ embeds: [statusEmbed] });
                    return;
                }

                // Lệnh xem danh sách nhóm FB qua Discord
                if (text.toLowerCase() === '!groups') {
                    const activeGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);
                    if (activeGroups.length === 0) {
                        await message.reply('⚠️ Hiện chưa có nhóm Facebook nào được chọn trong Tool Desktop. Hãy vào tab "Nhóm Facebook" trên tool để tích chọn!');
                        return;
                    }
                    const listStr = activeGroups.slice(0, 15).map((g, i) => `${i + 1}. **${g.name}**`).join('\n');
                    const extra = activeGroups.length > 15 ? `\n... và ${activeGroups.length - 15} nhóm khác.` : '';
                    await message.reply(`👥 **Danh sách ${activeGroups.length} nhóm Facebook đang kích hoạt để đăng bài:**\n\n${listStr}${extra}`);
                    return;
                }

                if (!text && images.length === 0 && zips.length === 0) return;

                const mediaDetails = [];
                if (images.length > 0) mediaDetails.push(`${images.length} ảnh`);
                if (zips.length > 0) mediaDetails.push(`${zips.length} file zip`);
                const mediaStr = mediaDetails.length > 0 ? ` (${mediaDetails.join(', ')})` : '';

                await dbAsync.log('info', `[Discord Bot] Bắt được tin mới từ ${message.author.tag} (${text ? text.substring(0, 40) + '...' : ''}${mediaStr})`);

                // Thêm phản ứng emoji để người dùng biết bot đã nhận
                try {
                    await message.react('⏳');
                } catch (e) {
                    // Ignore reaction permission errors
                }

                // Quản lý bộ đệm (Debounce 60 giây)
                let buffer = channelBuffers.get(message.channelId);
                if (buffer) {
                    clearTimeout(buffer.timer);
                    if (text) buffer.texts.push(text);
                    if (images.length > 0) buffer.images.push(...images);
                    if (zips.length > 0) buffer.zips.push(...zips);
                } else {
                    buffer = {
                        channel: message.channel,
                        username: message.member?.displayName || message.author.username,
                        userTag: message.author.tag,
                        texts: text ? [text] : [],
                        images: [...images],
                        zips: [...zips]
                    };
                    channelBuffers.set(message.channelId, buffer);
                }

                const debounceMs = currentConfig.debounceSeconds * 1000;
                buffer.timer = setTimeout(async () => {
                    await processDiscordBuffer(message.channelId);
                }, debounceMs);

            } catch (err) {
                console.error('[Discord] Lỗi xử lý messageCreate:', err);
            }
        });

        // Xử lý khi người dùng bấm nút trên Discord (Duyệt, Viết lại, Hủy)
        // Xử lý khi người dùng tương tác trên Discord (Select Menu chọn cụm, Nút bấm Duyệt/ACP, Viết lại, Hủy)
        client.on('interactionCreate', async (interaction) => {
            // A. XỬ LÝ CHỌN CỤM TỪ SELECT MENU
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith('discord_select_cluster_')) {
                const postId = parseInt(interaction.customId.replace('discord_select_cluster_', ''), 10);
                const selectedVal = interaction.values[0];
                await interaction.deferUpdate();

                let clusterName = '';
                let groups = [];
                let clusterId = 'all';

                if (selectedVal === 'cluster_all') {
                    clusterName = 'Toàn bộ nhóm đang bật';
                    groups = await dbAsync.all(`SELECT name, url FROM fb_groups WHERE is_active = 1`);
                } else {
                    clusterId = parseInt(selectedVal.replace('cluster_', ''), 10);
                    const clusterDetails = await dbAsync.getClusterDetails(clusterId);
                    clusterName = clusterDetails?.name || `Cụm #${clusterId}`;
                    groups = clusterDetails?.groups || [];
                }

                if (groups.length === 0) {
                    const backRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`discord_choose_cluster_${postId}`)
                            .setLabel('🔙 Chọn Cụm Khác')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`discord_reject_${postId}`)
                            .setLabel('❌ Hủy bài')
                            .setStyle(ButtonStyle.Danger)
                    );
                    await interaction.editReply({
                        content: `⚠️ **Cụm [${clusterName}] hiện chưa có nhóm Facebook nào được gán!**\nVui lòng vào Tool Desktop gán nhóm cho cụm này, hoặc chọn cụm khác:`,
                        components: [backRow]
                    });
                    return;
                }

                // Hiển thị danh sách nhóm trong cụm và nút [Xác Nhận Đăng (ACP)]
                const groupListStr = groups.slice(0, 10).map((g, idx) => `${idx + 1}. **${g.name}**`).join('\n');
                const extraStr = groups.length > 10 ? `\n... và ${groups.length - 10} nhóm khác nữa.` : '';

                const confirmEmbed = new EmbedBuilder()
                    .setColor(0x2ecc71)
                    .setTitle(`🎯 XÁC NHẬN ĐĂNG BÀI #${postId} THEO CỤM`)
                    .setDescription(`Bạn đã chọn đăng bài vào:\n📍 **Cụm:** **${clusterName}**\n👥 **Tổng cộng:** **${groups.length} nhóm**\n\n📋 **Danh sách nhóm:**\n${groupListStr}${extraStr}`)
                    .setFooter({ text: 'Kiểm tra kỹ các nhóm trên. Bấm [Xác Nhận Đăng (ACP)] để bắt đầu đăng ngay!' });

                const confirmButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`discord_acp_${postId}_${clusterId}`)
                        .setLabel('🚀 Xác Nhận Đăng (ACP)')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`discord_choose_cluster_${postId}`)
                        .setLabel('🔙 Chọn Cụm Khác')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`discord_reject_${postId}`)
                        .setLabel('❌ Hủy bỏ')
                        .setStyle(ButtonStyle.Danger)
                );

                await interaction.editReply({
                    content: `👉 **Đã chọn cụm thành công! Vui lòng xác nhận (ACP) để đăng bài:**`,
                    embeds: [confirmEmbed],
                    components: [confirmButtons]
                });
                return;
            }

            if (!interaction.isButton()) return;
            const customId = interaction.customId;

            // B1. Bấm NÚT DUYỆT THEO CỤM (hoặc DUYỆT & ĐĂNG FB)
            if (customId.startsWith('discord_choose_cluster_') || customId.startsWith('discord_approve_')) {
                const idPart = customId.replace('discord_choose_cluster_', '').replace('discord_approve_', '');
                const postId = parseInt(idPart, 10);
                await interaction.deferUpdate();

                const clusters = await dbAsync.getClusters();
                const activeFbGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);

                if (clusters.length === 0) {
                    // Chưa có cụm nào -> hỏi người dùng đăng tất cả nhóm luôn
                    const confirmRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`discord_acp_${postId}_all`)
                            .setLabel(`🚀 Xác Nhận Đăng Tất Cả (${activeFbGroups.length} nhóm) [ACP]`)
                            .setStyle(ButtonStyle.Success),
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
                        content: `⚠️ **Chưa có Cụm Nhóm nào được tạo trong Tool Desktop!**\nBạn có thể vào tab "Quản Lý Nhóm FB" trên Tool để tạo cụm nhóm, hoặc bấm xác nhận đăng lên toàn bộ nhóm bên dưới:`,
                        components: [confirmRow]
                    });
                    return;
                }

                // Có cụm nhóm -> hiển thị Select Menu để người dùng chọn cụm
                const options = clusters.map(c => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`Cụm: ${c.name}`.slice(0, 100))
                        .setDescription(`${c.group_count} nhóm Facebook`.slice(0, 100))
                        .setValue(`cluster_${c.id}`)
                        .setEmoji('📍')
                );

                // Thêm tùy chọn Tất cả nhóm đang bật
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`Toàn bộ nhóm đang bật`)
                        .setDescription(`${activeFbGroups.length} nhóm Facebook đã kích hoạt`.slice(0, 100))
                        .setValue(`cluster_all`)
                        .setEmoji('🌐')
                );

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`discord_select_cluster_${postId}`)
                    .setPlaceholder('🎯 Chọn Cụm Nhóm Facebook bạn muốn đăng...')
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
                    content: `🎯 **Vui lòng chọn Cụm Nhóm Facebook để đăng bài #${postId}:**\n*(Sau khi chọn cụm, bạn sẽ được xem tóm tắt các nhóm trước khi bấm Xác Nhận ACP)*`,
                    components: [menuRow, cancelRow]
                });
                return;
            }

            // B2. Bấm NÚT QUAY LẠI TỪ BƯỚC CHỌN CỤM
            if (customId.startsWith('discord_cancel_select_')) {
                const postId = parseInt(customId.replace('discord_cancel_select_', ''), 10);
                await interaction.deferUpdate();
                await interaction.editReply({
                    content: `✨ **Bài viết #${postId} đã sẵn sàng!** Vui lòng kiểm tra và bấm nút bên dưới:`,
                    components: [createApprovalButtons(postId, false)]
                });
                return;
            }

            // B3. Bấm NÚT XÁC NHẬN ĐĂNG (ACP)
            if (customId.startsWith('discord_acp_')) {
                // customId format: discord_acp_${postId}_${clusterId}
                const parts = customId.split('_');
                const postId = parseInt(parts[2], 10);
                const clusterId = parts[3]; // 'all' or number
                await interaction.deferUpdate();

                let clusterLabel = 'Tất cả nhóm';
                if (clusterId !== 'all') {
                    const c = await dbAsync.get(`SELECT name FROM fb_clusters WHERE id = ?`, [clusterId]);
                    if (c) clusterLabel = c.name;
                }

                await dbAsync.log('info', `[Discord] Bạn đã xác nhận (ACP) đăng bài #${postId} vào Cụm [${clusterLabel}]!`);

                // Vô hiệu hóa nút và thông báo đang tiến hành đăng
                await interaction.editReply({
                    content: `🚀 **ĐÃ XÁC NHẬN (ACP) BÀI #${postId}!**\nTool đang tiến hành đăng rải rác lộn xộn vào **Cụm [${clusterLabel}]**...`,
                    components: []
                });

                // Cập nhật trạng thái post
                await dbAsync.run(`UPDATE posts SET status = 'approved', target_cluster_id = ? WHERE id = ?`, [clusterId === 'all' ? null : clusterId, postId]);

                // Bắt đầu đăng bài
                try {
                    const result = await publishPost(postId, clusterId);
                    if (result?.success) {
                        await interaction.followUp({
                            content: `🎉 **ĐĂNG BÀI #${postId} THÀNH CÔNG!** Đã hoàn tất đăng bài vào Cụm **[${clusterLabel}]** an toàn!`,
                            ephemeral: false
                        });
                    }
                } catch (pubErr) {
                    await dbAsync.log('error', `[Discord] Lỗi khi đăng bài #${postId} vào Cụm [${clusterLabel}]: ${pubErr.message}`);
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
                await interaction.deferUpdate();

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
                await interaction.deferUpdate();

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
                const activeFbGroups = await dbAsync.all(`SELECT name FROM fb_groups WHERE is_active = 1`);
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
    downloadAndSaveDiscordImages
};
