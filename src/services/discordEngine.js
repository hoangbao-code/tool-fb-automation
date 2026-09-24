const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { dbAsync } = require('../db');
const { rewriteWithGemini } = require('./gemini');
const { publishPost } = require('./fbEngine');
const { isChromeDebuggingActive } = require('./chromeGemini');

let discordClient = null;
let currentConfig = null;
let eventBroadcaster = null;

// Quản lý bộ đệm tin nhắn (Debounce 60 giây) cho từng kênh
const channelBuffers = new Map();

function setDiscordEventBroadcaster(fn) {
    eventBroadcaster = fn;
}

/**
 * Trích xuất link ảnh từ tin nhắn Discord
 */
function extractImageUrls(message) {
    const urls = [];
    if (message.attachments && message.attachments.size > 0) {
        message.attachments.forEach(att => {
            const isImage = (att.contentType && att.contentType.startsWith('image/')) ||
                /\.(png|jpe?g|webp|gif|bmp)$/i.test(att.name || att.url);
            if (isImage) {
                urls.push(att.url);
            }
        });
    }
    return urls;
}

/**
 * Tạo giao diện nút bấm duyệt bài cho Discord
 */
function createApprovalButtons(postId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`discord_approve_${postId}`)
            .setLabel('✅ Duyệt & Đăng FB')
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

    const { channel, texts, images, username, userTag } = buffer;
    const combinedText = texts.filter(Boolean).join('\n\n').trim();
    const uniqueImages = [...new Set(images)];

    if (!combinedText && uniqueImages.length === 0) return;

    await dbAsync.log('info', `[Discord Bot] Đã hết 1 phút chờ. Bắt đầu xử lý bài đăng từ ${userTag} (${combinedText.length} ký tự, ${uniqueImages.length} ảnh)...`);

    // Gửi thông báo đang xử lý vào Discord
    let statusMsg = null;
    try {
        statusMsg = await channel.send(`⏳ **Đã gom xong bài (${uniqueImages.length} ảnh)!** Đang gửi vào Google Chrome Gemini Web để biên tập lại nội dung, bạn chờ chút nhé...`);
    } catch (e) {
        console.warn('[Discord] Không thể gửi status message:', e.message);
    }

    // 1. Lưu tin nhắn gốc vào bảng messages
    let msgRecord = null;
    try {
        msgRecord = await dbAsync.run(
            `INSERT INTO messages (group_name, sender, content, images) VALUES (?, ?, ?, ?)`,
            [`Discord: #${channel.name || 'channel'}`, userTag || username, combinedText, JSON.stringify(uniqueImages)]
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
            `INSERT INTO posts (message_id, group_name, original_text, rewritten_text, target_fb_group, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [msgRecord?.id || null, `Discord: #${channel.name || 'channel'}`, combinedText, rewritten, targetFbStr, 'pending']
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
            images: uniqueImages,
            status: 'pending',
            targetFbGroup: targetFbStr,
            time: new Date().toLocaleTimeString('vi-VN')
        });
    }

    // 5. Gửi bài viết và các nút bấm Xác nhận trở lại kênh Discord
    try {
        const embed = new EmbedBuilder()
            .setColor(aiSuccess ? 0x2ecc71 : 0xf39c12)
            .setTitle(`📝 BÀI VIẾT ĐÃ BIÊN TẬP XONG (Mã bài: #${postId})`)
            .setDescription(rewritten.length > 4000 ? rewritten.substring(0, 3995) + '...' : rewritten)
            .addFields(
                { name: '📸 Hình ảnh', value: `${uniqueImages.length} ảnh đính kèm`, inline: true },
                { name: '🎯 Nhóm FB đích', value: `${activeFbGroups.length} nhóm đang bật`, inline: true },
                { name: '🤖 Trạng thái AI', value: aiSuccess ? '✓ Gemini Web biên tập' : '⚠️ Nội dung gốc (AI bận)', inline: true }
            )
            .setFooter({ text: 'Kiểm tra nội dung phía trên. Bấm nút bên dưới để Đăng bài ngay lên Facebook!' })
            .setTimestamp();

        if (uniqueImages.length > 0) {
            embed.setImage(uniqueImages[0]);
        }

        const buttonsRow = createApprovalButtons(postId, false);

        if (statusMsg) {
            await statusMsg.edit({
                content: `✨ **Bài viết #${postId} đã sẵn sàng!** Vui lòng kiểm tra và bấm nút xác nhận bên dưới:`,
                embeds: [embed],
                components: [buttonsRow]
            });
        } else {
            await channel.send({
                content: `✨ **Bài viết #${postId} đã sẵn sàng!** Vui lòng kiểm tra và bấm nút xác nhận bên dưới:`,
                embeds: [embed],
                components: [buttonsRow]
            });
        }

        await dbAsync.log('info', `[Discord Bot] Đã gửi bài #${postId} kèm nút bấm duyệt vào kênh Discord (#${channel.name}). Đang chờ bạn bấm xác nhận...`);
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
                const images = extractImageUrls(message);

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
                        .setFooter({ text: 'Gửi nội dung & ảnh phòng vào kênh này. Bot sẽ gom sau 1 phút và gửi nút duyệt!' })
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

                if (!text && images.length === 0) return;

                await dbAsync.log('info', `[Discord Bot] Bắt được tin mới từ ${message.author.tag} (${text ? text.substring(0, 40) + '...' : ''} - ${images.length} ảnh)`);

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
                } else {
                    buffer = {
                        channel: message.channel,
                        username: message.member?.displayName || message.author.username,
                        userTag: message.author.tag,
                        texts: text ? [text] : [],
                        images: [...images]
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
        client.on('interactionCreate', async (interaction) => {
            if (!interaction.isButton()) return;

            const customId = interaction.customId;

            // 1. Bấm NÚT DUYỆT & ĐĂNG BÀI
            if (customId.startsWith('discord_approve_')) {
                const postId = parseInt(customId.replace('discord_approve_', ''), 10);
                await interaction.deferUpdate();

                await dbAsync.log('info', `[Discord] Bạn đã bấm [Duyệt & Đăng bài #${postId}] trực tiếp từ Discord!`);

                // Vô hiệu hóa nút và thông báo đang đăng
                await interaction.editReply({
                    content: `🚀 **ĐÃ DUYỆT BÀI #${postId}!**\nTool đang tiến hành đăng rải rác lộn xộn lên các nhóm Facebook đã chọn...`,
                    components: [createApprovalButtons(postId, true)]
                });

                // Cập nhật trạng thái post
                await dbAsync.run(`UPDATE posts SET status = 'approved' WHERE id = ?`, [postId]);

                // Bắt đầu đăng bài
                try {
                    const result = await publishPost(postId);
                    if (result?.success) {
                        await interaction.followUp({
                            content: `🎉 **ĐĂNG BÀI #${postId} THÀNH CÔNG!** Đã hoàn tất đăng bài lên toàn bộ các nhóm Facebook an toàn!`,
                            ephemeral: false
                        });
                    }
                } catch (pubErr) {
                    await dbAsync.log('error', `[Discord] Lỗi khi đăng bài #${postId} lên Facebook: ${pubErr.message}`);
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
    processDiscordBuffer // Exported for unit tests
};
