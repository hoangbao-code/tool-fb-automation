// State quản lý giao diện Desktop
const state = {
    currentTab: 'feed',
    status: {},
    settings: {},
    posts: [],
    fbGroups: [],
    zaloGroups: [],
    filter: 'all',
    activeZaloGroup: ''
};

// Khởi tạo ứng dụng
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    setupWebviews();
    setupEventListeners();
    switchTab('feed');
    await loadInitialData();
    checkChromeGeminiUI(true);
});

// Thiết lập Webview Zalo & Facebook với Preload chuyên dụng
function setupWebviews() {
    const zaloWv = document.getElementById('zalo-wv');
    const fbWv = document.getElementById('fb-wv');

    if (window.electronApi) {
        // Gắn đường dẫn preload tuyệt đối đã resolve
        if (window.electronApi.zaloPreloadPath) {
            zaloWv.setAttribute('preload', window.electronApi.zaloPreloadPath);
        }
        if (window.electronApi.fbPreloadPath) {
            fbWv.setAttribute('preload', window.electronApi.fbPreloadPath);
        }

        // Lắng nghe sự kiện từ Webview Zalo
        zaloWv.addEventListener('ipc-message', (event) => {
            if (event.channel === 'zalo-message-captured') {
                window.electronApi.forwardZaloMessage(event.args[0]);
            } else if (event.channel === 'current-group-response') {
                state.activeZaloGroup = event.args[0]?.groupName || '';
                updateZaloActiveGroupDisplay();
            } else if (event.channel === 'zalo-groups-scanned') {
                if (Array.isArray(event.args[0]) && event.args[0].length > 0) {
                    window.electronApi.addZaloGroupsBulk(event.args[0]);
                    loadZaloGroups();
                }
            }
        });

        // Lắng nghe sự kiện từ Webview Facebook
        fbWv.addEventListener('ipc-message', (event) => {
            if (event.channel === 'fb-groups-scanned') {
                window.electronApi.forwardFbGroups(event.args[0]);
                showToast(`Đã nhận diện ${event.args[0]?.length || 0} nhóm Facebook!`, 'success');
                loadFbGroups();
            }
        });

        // Lắng nghe sự kiện từ Webview Gemini Web
        const geminiWv = document.getElementById('gemini-wv');
        if (geminiWv) {
            geminiWv.addEventListener('dom-ready', () => {
                updateGeminiStatusUI('Sẵn sàng tự động gửi tin', 'ready');
            });
            geminiWv.addEventListener('did-fail-load', (e) => {
                if (e.errorCode !== -3) {
                    updateGeminiStatusUI('Mất kết nối mạng', 'error');
                }
            });
            geminiWv.addEventListener('new-window', (e) => {
                if (e.url) {
                    geminiWv.loadURL(e.url);
                }
            });
        }

        // Định kỳ đọc tên nhóm Zalo đang mở & tự động bắt tin mới bằng executeJavaScript
        setInterval(async () => {
            try {
                // 1. Cập nhật tên nhóm đang mở
                const activeName = await zaloWv.executeJavaScript(`
                    (function() {
                        var selectors = ['#header-title', '.header-title', '.chat-title', '[data-id="chat-title"]', '.conv-item.active .conv-item-title__more'];
                        for (var i = 0; i < selectors.length; i++) {
                            var el = document.querySelector(selectors[i]);
                            if (el && el.innerText && el.innerText.trim()) return el.innerText.trim();
                        }
                        return '';
                    })();
                `);
                if (activeName && activeName !== state.activeZaloGroup) {
                    state.activeZaloGroup = activeName;
                    updateZaloActiveGroupDisplay();
                }

                // 2. Tự động gom tin nhắn Zalo mới
                const newMsgs = await zaloWv.executeJavaScript(`
                    (function() {
                        window.__seenZaloMsgs = window.__seenZaloMsgs || {};
                        var newMessages = [];
                        var selectors = ['#header-title', '.header-title', '.chat-title', '[data-id="chat-title"]', '.conv-item.active .conv-item-title__more'];
                        var groupName = '';
                        for (var i = 0; i < selectors.length; i++) {
                            var el = document.querySelector(selectors[i]);
                            if (el && el.innerText && el.innerText.trim()) { groupName = el.innerText.trim(); break; }
                        }
                        if (!groupName) return [];

                        var msgElements = document.querySelectorAll('.chat-message, .msg-view, [id^="msg-"], div[class*="message-view"]');
                        msgElements.forEach(function(el) {
                            var msgId = el.getAttribute('id') || el.getAttribute('data-id') || (groupName + '_' + el.innerText.substring(0, 40));
                            if (window.__seenZaloMsgs[msgId]) return;
                            window.__seenZaloMsgs[msgId] = true;

                            var senderEl = el.querySelector('.sender-name, [class*="sender"], [class*="author"]');
                            var sender = senderEl ? senderEl.innerText.trim() : 'Thành viên';

                            var textEl = el.querySelector('.content-text, .msg-text, [class*="content-text"], [class*="text-msg"]');
                            var text = textEl ? textEl.innerText.trim() : '';

                            var images = [];
                            el.querySelectorAll('img').forEach(function(img) {
                                var src = img.getAttribute('src');
                                if (src && src.indexOf('avatar') === -1 && src.indexOf('icon') === -1 && src.indexOf('emoji') === -1) {
                                    images.push(src);
                                }
                            });

                            if (text || images.length > 0) {
                                newMessages.push({ groupName: groupName, sender: sender, text: text, images: images });
                            }
                        });
                        return newMessages;
                    })();
                `);
                if (Array.isArray(newMsgs) && newMsgs.length > 0) {
                    for (const m of newMsgs) {
                        window.electronApi.forwardZaloMessage(m);
                    }
                }
            } catch (e) {}
        }, 2000);
    }
}

// Thiết lập các sự kiện thời gian thực từ Electron
function setupEventListeners() {
    if (!window.electronApi) return;

    window.electronApi.on('new-zalo-message', (msg) => {
        showToast(`Bắt được tin từ nhóm [${msg.groupName}]!`, 'info');
        loadStatus();
    });

    window.electronApi.on('new-post-ready', (post) => {
        showToast(`AI vừa biên tập xong bài viết #${post.id}!`, 'success');
        loadPosts();
        loadStatus();
    });

    window.electronApi.on('post-published', (data) => {
        showToast(`Đã xuất bản thành công bài #${data.id} lên Facebook!`, 'success');
        loadPosts();
        loadStatus();
    });

    window.electronApi.on('fb-groups-updated', () => {
        loadFbGroups();
    });

    window.electronApi.on('fb-publish-step', (stepData) => {
        const fbWv = document.getElementById('fb-wv');
        if (fbWv && stepData.groupUrl) {
            fbWv.loadURL(stepData.groupUrl);
            setTimeout(() => {
                try {
                    fbWv.send('publish-to-fb', {
                        postId: stepData.postId,
                        content: stepData.content,
                        groups: [{ name: stepData.groupName, url: stepData.groupUrl, content: stepData.content }]
                    });
                } catch (e) {}
            }, 3000);
        }
    });

    window.electronApi.on('new-log-entry', (log) => {
        appendLogEntry(log);
    });

    window.electronApi.on('discord-bot-status', (data) => {
        updateDiscordStatusUI(data);
    });
}

// Chuyển Tab giao diện
function switchTab(tabId) {
    state.currentTab = tabId;

    // 1. Cập nhật hiển thị Pane bằng class (Giữ cho webviews không bị đóng băng layout)
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.remove('active');
        p.style.removeProperty('display');
        p.style.removeProperty('visibility');
        p.style.removeProperty('pointer-events');
        p.style.removeProperty('z-index');
    });

    const target = document.getElementById(`tab-${tabId}`);
    if (target) {
        target.classList.add('active');
    }

    // 2. Cập nhật nút bấm Sidebar
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-btn-${tabId}`);
    if (activeBtn) activeBtn.classList.add('active');

    // 3. Cập nhật tiêu đề trang
    const titles = {
        feed: { title: 'BẢNG TIN & HÀNG ĐỢI DUYỆT', sub: 'Xem xét và xuất bản bài viết tự động' },
        zalo: { title: 'ZALO WEB TRỰC TIẾP', sub: 'Đăng nhập 1 lần lưu vĩnh viễn - Tự động bắt tin ngầm' },
        fb: { title: 'FACEBOOK TRỰC TIẾP', sub: 'Tự động quét nhóm đã tham gia và xuất bản bài viết' },
        groups: { title: 'QUẢN LÝ NHÓM FACEBOOK', sub: 'Tích chọn các nhóm mục tiêu để đăng bài' },
        'zalo-groups': { title: 'QUẢN LÝ NHÓM ZALO', sub: 'Tích chọn các nhóm Zalo cần tự động gom tin' },
        discord: { title: 'NGUỒN TIN DISCORD BOT', sub: 'Nhận bài + ảnh từ Discord, gom sau 1 phút, biên tập Gemini Web và duyệt bài tương tác' },
        ai: { title: 'GEMINI WEB TRỰC TIẾP', sub: 'Tự động gửi tin vào cuộc trò chuyện & trích xuất bài đăng' },
        settings: { title: 'CÀI ĐẶT HỆ THỐNG', sub: 'Cấu hình thời gian giãn cách chống spam và tự động hóa' },
        logs: { title: 'NHẬT KÝ HOẠT ĐỘNG', sub: 'Theo dõi tiến trình hệ thống theo thời gian thực' }
    };
    if (titles[tabId]) {
        document.getElementById('page-title').innerText = titles[tabId].title;
        document.getElementById('page-subtitle').innerText = `| ${titles[tabId].sub}`;
    }

    lucide.createIcons();

    if (tabId === 'feed') loadPosts();
    else if (tabId === 'groups') loadFbGroups();
    else if (tabId === 'zalo-groups') loadZaloGroups();
    else if (tabId === 'discord') loadDiscordSettingsUI();
    else if (tabId === 'ai') { loadAiSettings(); checkChromeGeminiUI(true); }
    else if (tabId === 'settings') loadGeneralSettings();
    else if (tabId === 'logs') loadLogs();
}

async function loadInitialData() {
    checkChromeGeminiUI(true);
    await Promise.all([
        loadStatus(),
        loadPosts(),
        loadFbGroups(),
        loadZaloGroups(),
        loadDiscordSettingsUI(),
        loadAiSettings(),
        loadGeneralSettings(),
        loadLogs()
    ]);
}

async function refreshData() {
    await loadInitialData();
    showToast('Đã làm mới dữ liệu!', 'info');
}

// 1. Thống kê & Trạng thái
async function loadStatus() {
    try {
        const res = await window.electronApi.getStatus();
        if (res.success) {
            state.status = res.stats;
            document.getElementById('head-stat-zalo').innerText = res.stats.messagesToday;
            document.getElementById('head-stat-pending').innerText = res.stats.pendingPosts;
            document.getElementById('head-stat-posted').innerText = res.stats.postedPosts;

            const badge = document.getElementById('badge-pending-count');
            if (res.stats.pendingPosts > 0) {
                badge.innerText = res.stats.pendingPosts;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }

            const autoBtn = document.getElementById('quick-auto-btn');
            if (res.stats.autoPostEnabled) {
                autoBtn.innerText = 'Đang bật';
                autoBtn.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-600 text-white transition-all';
            } else {
                autoBtn.innerText = 'Đang tắt';
                autoBtn.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-400 hover:text-white transition-all';
            }
        }
    } catch (e) {
        console.error('Error loadStatus:', e);
    }
}

async function toggleAutoPost() {
    const isCurrentlyOn = state.status.autoPostEnabled;
    const newVal = isCurrentlyOn ? '0' : '1';
    await window.electronApi.saveSettings({ auto_post_enabled: newVal });
    showToast(newVal === '1' ? 'Đã BẬT Tự động đăng bài!' : 'Đã TẮT Tự động đăng bài.', 'info');
    loadStatus();
    loadGeneralSettings();
}

async function toggleEmergencyStop() {
    const stopBtn = document.getElementById('quick-stop-btn');
    const isStop = stopBtn.innerText.includes('DỪNG');
    const newVal = isStop ? '0' : '1';
    await window.electronApi.saveSettings({ emergency_stop: newVal });
    if (newVal === '1') {
        stopBtn.innerText = 'ĐÃ DỪNG';
        stopBtn.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-rose-600 text-white transition-all';
        showToast('ĐÃ KÍCH HOẠT DỪNG KHẨN CẤP!', 'error');
    } else {
        stopBtn.innerText = 'Bình thường';
        stopBtn.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-400 hover:text-rose-400 transition-all';
        showToast('Đã hủy dừng khẩn cấp.', 'info');
    }
    loadGeneralSettings();
}

// 2. Bảng Tin & Hàng Đợi (Feed & Review)
async function loadPosts() {
    try {
        const res = await window.electronApi.getPosts();
        if (res.success) {
            state.posts = res.posts;
            renderPosts();
        }
    } catch (e) {
        console.error('Error loadPosts:', e);
    }
}

// Quản lý bộ lọc & Tìm kiếm Bảng Tin
function setFilter(filterType) {
    state.filter = filterType;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`filter-btn-${filterType}`);
    if (activeBtn) activeBtn.classList.add('active');
    renderPosts();
}

function onFeedSearch(val) {
    state.feedSearch = (val || '').trim().toLowerCase();
    const clearBtn = document.getElementById('feed-search-clear');
    if (clearBtn) {
        if (state.feedSearch) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }
    renderPosts();
}

function clearFeedSearch() {
    state.feedSearch = '';
    const input = document.getElementById('feed-search-input');
    if (input) input.value = '';
    const clearBtn = document.getElementById('feed-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
    renderPosts();
}

// Cập nhật các con số thống kê & badge bộ lọc
function updateFeedCounters() {
    const posts = state.posts || [];
    const total = posts.length;
    const pending = posts.filter(p => p.status === 'pending').length;
    const approved = posts.filter(p => p.status === 'approved').length;
    const posted = posts.filter(p => p.status === 'posted').length;

    // Header stat cards
    const elTotal = document.getElementById('feed-stat-total');
    const elPending = document.getElementById('feed-stat-pending');
    const elApproved = document.getElementById('feed-stat-approved');
    const elPosted = document.getElementById('feed-stat-posted');
    if (elTotal) elTotal.innerText = total;
    if (elPending) elPending.innerText = pending;
    if (elApproved) elApproved.innerText = approved;
    if (elPosted) elPosted.innerText = posted;

    // Filter button badges
    const bTotal = document.getElementById('badge-count-all');
    const bPending = document.getElementById('badge-count-pending');
    const bApproved = document.getElementById('badge-count-approved');
    const bPosted = document.getElementById('badge-count-posted');
    if (bTotal) bTotal.innerText = total;
    if (bPending) bPending.innerText = pending;
    if (bApproved) bApproved.innerText = approved;
    if (bPosted) bPosted.innerText = posted;

    // Sidebar badge
    const sbPending = document.getElementById('badge-pending-count');
    if (sbPending) {
        sbPending.innerText = pending;
        if (pending > 0) sbPending.classList.remove('hidden');
        else sbPending.classList.add('hidden');
    }
}

// Hàm render ảnh đính kèm (thumbnails)
function renderPostImages(imagesData) {
    if (!imagesData) return '';
    let imgs = [];
    try {
        if (Array.isArray(imagesData)) imgs = imagesData;
        else if (typeof imagesData === 'string' && imagesData.startsWith('[')) imgs = JSON.parse(imagesData);
    } catch (e) {}

    if (!Array.isArray(imgs) || imgs.length === 0) return '';

    return `
        <div class="mt-2.5 pt-2 border-t border-slate-800/80">
            <span class="text-[10px] uppercase font-bold text-slate-500 mb-1.5 flex items-center gap-1">
                <i data-lucide="image" class="w-3 h-3 text-blue-400"></i> Ảnh đính kèm (${imgs.length}):
            </span>
            <div class="flex flex-wrap gap-2">
                ${imgs.slice(0, 4).map((src, idx) => `
                    <div class="relative group/img w-14 h-14 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 shadow-sm cursor-pointer" onclick="window.open('${escapeHtml(src)}', '_blank')">
                        <img src="${escapeHtml(src)}" class="w-full h-full object-cover group-hover/img:scale-110 transition-all duration-200" alt="Ảnh ${idx + 1}" />
                    </div>
                `).join('')}
                ${imgs.length > 4 ? `
                    <div class="w-14 h-14 rounded-lg bg-slate-800/80 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
                        +${imgs.length - 4}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

// Sao chép nội dung bài viết
async function copyPostTextUI(id, type) {
    const post = (state.posts || []).find(p => p.id === id);
    if (!post) return;
    const text = type === 'original' ? post.original_text : (post.rewritten_text || post.original_text);
    if (!text) {
        showToast('Không có nội dung để sao chép', 'warning');
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        showToast(`Đã sao chép nội dung bài #${id}!`, 'success');
    } catch (e) {
        showToast('Lỗi sao chép: ' + e.message, 'error');
    }
}

// Duyệt 1 bài viết sang trạng thái approved
async function approvePostDirect(id) {
    try {
        const res = await window.electronApi.approvePost(id);
        if (res.success) {
            showToast(`Đã duyệt bài viết #${id}! Bài sẽ được worker đăng tự động.`, 'success');
            await loadPosts();
            await loadStatus();
        } else {
            showToast(res.error || 'Lỗi khi duyệt bài', 'error');
        }
    } catch (e) {
        showToast('Lỗi: ' + e.message, 'error');
    }
}

// Duyệt tất cả bài đang chờ duyệt
async function approveAllPendingUI() {
    const pendingCount = (state.posts || []).filter(p => p.status === 'pending').length;
    if (pendingCount === 0) {
        showToast('Hiện không có bài viết nào đang chờ duyệt', 'info');
        return;
    }
    if (!confirm(`Bạn có chắc muốn DUYỆT TẤT CẢ ${pendingCount} bài viết đang chờ không?\nCác bài này sẽ chuyển sang trạng thái "Đã duyệt" để hệ thống tự động đăng lên Facebook theo lịch.`)) {
        return;
    }
    try {
        const res = await window.electronApi.approveAllPendingPosts();
        if (res.success) {
            showToast(`Đã duyệt thành công toàn bộ ${pendingCount} bài viết chờ!`, 'success');
            await loadPosts();
            await loadStatus();
        } else {
            showToast(res.error || 'Lỗi khi duyệt bài hàng loạt', 'error');
        }
    } catch (e) {
        showToast('Lỗi: ' + e.message, 'error');
    }
}

// RENDER TOÀN BỘ DANH SÁCH BÀI VIẾT (GIAO DIỆN HIỆN ĐẠI MỚI)
function renderPosts() {
    updateFeedCounters();
    const container = document.getElementById('feed-posts-container');
    if (!container) return;

    let filtered = state.posts || [];

    // Lọc theo trạng thái
    if (state.filter !== 'all') {
        filtered = filtered.filter(p => p.status === state.filter);
    }

    // Lọc theo từ khóa tìm kiếm
    if (state.feedSearch) {
        const q = state.feedSearch;
        filtered = filtered.filter(p =>
            (p.original_text && p.original_text.toLowerCase().includes(q)) ||
            (p.rewritten_text && p.rewritten_text.toLowerCase().includes(q)) ||
            (p.group_name && p.group_name.toLowerCase().includes(q)) ||
            (p.sender && p.sender.toLowerCase().includes(q)) ||
            String(p.id).includes(q)
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="py-20 text-center bg-gradient-to-b from-slate-950/60 to-slate-900/40 rounded-2xl border border-dashed border-slate-800 space-y-3 shadow-inner">
                <div class="w-14 h-14 mx-auto rounded-2xl bg-slate-800/80 flex items-center justify-center text-slate-500 shadow-md">
                    <i data-lucide="inbox" class="w-7 h-7 text-slate-400"></i>
                </div>
                <div class="space-y-1">
                    <p class="text-sm font-bold text-white">Chưa có bài viết nào trong danh mục này</p>
                    <p class="text-xs text-slate-400 max-w-sm mx-auto">
                        Khi có tin nhắn mới từ Zalo hoặc sau khi quét lịch sử, các bài viết sẽ tự động xuất hiện tại đây để bạn xem và duyệt.
                    </p>
                </div>
                ${state.feedSearch ? `
                    <button onclick="clearFeedSearch()" class="mt-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all">
                        <i data-lucide="x" class="w-3.5 h-3.5"></i> Xóa bộ lọc tìm kiếm
                    </button>
                ` : ''}
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    container.innerHTML = filtered.map(p => {
        // Kiểm tra xem bài có đang bị fallback nội dung thô không
        const isRawFallback = (!p.rewritten_text || p.rewritten_text.trim() === (p.original_text || '').trim());

        // Đường viền trái & màu sắc theo trạng thái
        let borderClass = 'border-l-4 border-l-amber-500 border-slate-800/90 hover:border-amber-500/40';
        let statusBadge = `
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> Chờ bạn duyệt
            </span>
        `;

        if (p.status === 'approved') {
            borderClass = 'border-l-4 border-l-emerald-500 border-slate-800/90 hover:border-emerald-500/40';
            statusBadge = `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <span class="w-2 h-2 rounded-full bg-emerald-400"></span> Đã duyệt (Sẵn sàng đăng)
                </span>
            `;
        } else if (p.status === 'posted') {
            borderClass = 'border-l-4 border-l-blue-500 border-slate-800/90 hover:border-blue-500/40';
            statusBadge = `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                    <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-blue-400"></i> Đã đăng thành công
                </span>
            `;
        } else if (p.status === 'failed') {
            borderClass = 'border-l-4 border-l-rose-500 border-slate-800/90 hover:border-rose-500/40';
            statusBadge = `
                <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-rose-400"></i> Lỗi đăng
                </span>
            `;
        }

        return `
            <div class="group bg-gradient-to-br from-slate-950/90 to-slate-900/80 border ${borderClass} rounded-2xl p-5 space-y-4 shadow-lg hover:shadow-2xl transition-all duration-200">
                <!-- Header bài viết -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/80 text-xs font-mono font-extrabold text-blue-400 shadow-inner">
                            #${p.id}
                        </span>
                        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/25 text-xs font-bold text-blue-300">
                            <i data-lucide="message-square" class="w-3.5 h-3.5 text-blue-400"></i>
                            ${escapeHtml(p.group_name || 'Nhóm Zalo')}
                        </span>
                        ${p.sender ? `
                            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800/70 border border-slate-700/50 text-[11px] font-medium text-slate-300">
                                <i data-lucide="user" class="w-3 h-3 text-slate-400"></i>
                                ${escapeHtml(p.sender)}
                            </span>
                        ` : ''}
                        ${statusBadge}
                    </div>

                    <div class="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 shrink-0">
                        <i data-lucide="clock" class="w-3.5 h-3.5 text-slate-500"></i>
                        <span>${formatDate(p.created_at)}</span>
                    </div>
                </div>

                <!-- So sánh song song: Tin Zalo Gốc -> Bản Biên Tập AI -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <!-- Khung Trái: Tin Zalo Gốc -->
                    <div class="flex flex-col bg-slate-900/90 rounded-xl border border-slate-800 p-4 space-y-2.5 shadow-sm">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800/80">
                            <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                <i data-lucide="message-square-text" class="w-3.5 h-3.5 text-blue-400"></i> Tin Nhắn Zalo Gốc
                            </span>
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] text-slate-500 font-mono">${(p.original_text || '').length} ký tự</span>
                                <button onclick="copyPostTextUI(${p.id}, 'original')" class="text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition-all flex items-center gap-1 font-medium" title="Sao chép tin nhắn gốc">
                                    <i data-lucide="copy" class="w-3 h-3"></i> Sao chép
                                </button>
                            </div>
                        </div>
                        <div class="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto font-sans pr-1">
                            ${escapeHtml(p.original_text || '(Không có nội dung)')}
                        </div>
                        ${renderPostImages(p.images)}
                    </div>

                    <!-- Khung Phải: Bài Viết AI Gemini Biên Tập -->
                    <div class="flex flex-col bg-gradient-to-br from-indigo-950/25 to-slate-900/90 rounded-xl border border-indigo-500/20 p-4 space-y-2.5 relative shadow-sm">
                        <div class="flex items-center justify-between pb-2 border-b border-indigo-500/20">
                            <div class="flex items-center gap-2">
                                <span class="text-[11px] font-extrabold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
                                    <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-400"></i> AI Gemini Biên Tập
                                </span>
                                ${isRawFallback ? `
                                    <span class="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded-md font-bold border border-amber-500/30">Nội dung thô</span>
                                ` : `
                                    <span class="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-md font-bold border border-emerald-500/30">Chuẩn mẫu</span>
                                `}
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-[10px] text-slate-400 font-mono">${(p.rewritten_text || '').length} ký tự</span>
                                <button onclick="copyPostTextUI(${p.id}, 'rewritten')" class="text-[11px] text-indigo-200 hover:text-white px-2.5 py-0.5 rounded-lg bg-indigo-900/70 hover:bg-indigo-800 transition-all flex items-center gap-1 font-bold border border-indigo-700/60 shadow-sm" title="Sao chép bài viết hoàn chỉnh">
                                    <i data-lucide="copy" class="w-3 h-3 text-amber-300"></i> Copy Bài Viết
                                </button>
                            </div>
                        </div>

                        ${isRawFallback ? `
                            <div class="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-start gap-2">
                                <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5"></i>
                                <div class="flex-1 text-[11px] leading-relaxed">
                                    Bài viết đang giữ nguyên văn tin thô (chưa qua mẫu Gemini). Hãy bấm <b>"Viết Lại AI"</b> bên dưới để áp dụng mẫu đăng bài của bạn.
                                </div>
                            </div>
                        ` : ''}

                        <div class="text-xs text-slate-100 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto font-sans pr-1">
                            ${escapeHtml(p.rewritten_text || p.original_text || '')}
                        </div>
                    </div>
                </div>

                <!-- Footer bài viết: Nhóm Facebook đích & Các nút thao tác -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-800/80 text-xs">
                    <div class="flex items-center gap-1.5 text-slate-400 text-xs">
                        <i data-lucide="send" class="w-3.5 h-3.5 text-indigo-400 shrink-0"></i>
                        <span>Đích đăng:</span>
                        <span class="text-slate-200 font-semibold px-2.5 py-0.5 rounded-lg bg-slate-900 border border-slate-800 truncate max-w-sm">
                            ${escapeHtml(p.target_fb_group || 'Tất cả nhóm Facebook đã chọn')}
                        </span>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <button onclick="reRewritePostUI(${p.id})" id="btn-ai-rewrite-${p.id}" class="px-3.5 py-1.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-md shadow-amber-900/30 hover:scale-[1.02] transition-all text-xs" title="Gửi tin nhắn này sang Chrome Gemini để viết lại theo đúng mẫu bạn ghim">
                            <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-200"></i> Viết Lại AI
                        </button>
                        <button onclick="openEditModal(${p.id})" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold rounded-xl flex items-center gap-1.5 transition-all text-xs" title="Chỉnh sửa nội dung bài viết trước khi đăng">
                            <i data-lucide="edit-3" class="w-3.5 h-3.5 text-blue-400"></i> Sửa Bài
                        </button>
                        <button onclick="deletePostDirectUI(${p.id})" class="px-2.5 py-1.5 bg-slate-900 hover:bg-rose-950/80 hover:text-rose-300 hover:border-rose-800/80 text-slate-400 border border-slate-800 font-semibold rounded-xl flex items-center gap-1 transition-all text-xs" title="Xóa bài viết này khỏi hàng đợi">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5 text-rose-400"></i> Xóa
                        </button>
                        ${p.status === 'pending' ? `
                            <button onclick="approvePostDirect(${p.id})" class="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-sm hover:scale-[1.02] transition-all text-xs" title="Duyệt bài để worker tự động đăng theo khung giờ vàng">
                                <i data-lucide="check" class="w-3.5 h-3.5"></i> Duyệt Bài
                            </button>
                            <button onclick="publishPostDirect(${p.id})" class="px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-md shadow-blue-900/30 hover:scale-[1.02] transition-all text-xs" title="Đăng bài ngay lập tức lên Facebook">
                                <i data-lucide="send" class="w-3.5 h-3.5"></i> Đăng Luôn
                            </button>
                        ` : p.status === 'approved' ? `
                            <button onclick="publishPostDirect(${p.id})" class="px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-md shadow-blue-900/30 hover:scale-[1.02] transition-all text-xs" title="Đăng bài ngay lập tức không cần chờ lịch">
                                <i data-lucide="send" class="w-3.5 h-3.5"></i> Đăng Ngay
                            </button>
                        ` : `
                            <button onclick="publishPostDirect(${p.id})" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold rounded-xl flex items-center gap-1.5 transition-all text-xs" title="Đăng lại bài viết này lên Facebook">
                                <i data-lucide="rotate-ccw" class="w-3.5 h-3.5 text-blue-400"></i> Đăng Lại
                            </button>
                        `}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function refreshPosts() {
    loadPosts();
    showToast('Đã làm mới hàng đợi bài viết!', 'info');
}

// Xóa tất cả bài viết trong bảng tin (Không chạm vào danh sách nhóm Zalo & FB)
async function clearAllPostsUI() {
    const filterDesc = state.filter === 'all' ? 'tất cả bài viết' : `các bài viết thuộc trạng thái [${getStatusLabel(state.filter)}]`;
    if (!confirm(`Bạn có chắc muốn XÓA ${filterDesc.toUpperCase()} trong bảng tin không?\n(Danh sách nhóm Zalo và nhóm Facebook được bảo toàn nguyên vẹn 100%)`)) {
        return;
    }
    const res = await window.electronApi.clearAllPosts(state.filter);
    if (res.success) {
        showToast(`Đã xóa sạch ${filterDesc}! (Bảo toàn nhóm Zalo & FB)`, 'success');
        await loadPosts();
        await loadStatus();
    } else {
        showToast(res.error || 'Lỗi khi xóa bài viết', 'error');
    }
}

// Xóa 1 bài viết trực tiếp
async function deletePostDirectUI(id) {
    const res = await window.electronApi.deletePost(id);
    if (res.success) {
        showToast(`Đã xóa bài viết #${id}!`, 'info');
        await loadPosts();
        await loadStatus();
    } else {
        showToast(res.error || 'Lỗi khi xóa bài viết', 'error');
    }
}

// Yêu cầu AI viết lại bài viết trong bảng tin duyệt
async function reRewritePostUI(id) {
    const btn = document.getElementById(`btn-ai-rewrite-${id}`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-amber-400"></i> Đang viết lại...`;
        if (window.lucide) lucide.createIcons();
    }
    showToast(`Đang gửi bài viết #${id} sang Chrome Gemini để viết lại...`, 'info');
    try {
        const res = await window.electronApi.reRewritePost(id);
        if (res.success && res.rewritten_text) {
            showToast(`Đã viết lại bài viết #${id} theo mẫu ghim thành công!`, 'success');
            await loadPosts();
        } else {
            showToast(res.error || 'Không thể viết lại bài viết', 'error');
        }
    } catch (e) {
        showToast('Lỗi: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-200"></i> Viết Lại AI`;
            if (window.lucide) lucide.createIcons();
        }
    }
}

// ==========================================
// TÍNH NĂNG GEMINI WEB TRỰC TIẾP (WEBVIEW)
// ==========================================

function updateGeminiStatusUI(text, status = 'ready') {
    const el = document.getElementById('gemini-status-indicator');
    if (!el) return;
    if (status === 'busy') {
        el.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 animate-spin"></span> ${escapeHtml(text)}`;
        el.className = 'text-amber-300 text-xs flex items-center gap-1.5 font-medium px-2.5 py-1 bg-slate-900 rounded-lg border border-slate-800';
    } else if (status === 'error') {
        el.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-400"></span> ${escapeHtml(text)}`;
        el.className = 'text-rose-400 text-xs flex items-center gap-1.5 font-medium px-2.5 py-1 bg-slate-900 rounded-lg border border-slate-800';
    } else if (status === 'connected') {
        el.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ${escapeHtml(text)}`;
        el.className = 'text-emerald-400 text-xs flex items-center gap-1.5 font-medium px-2.5 py-1 bg-slate-900 rounded-lg border border-emerald-900/50';
    } else {
        el.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500"></span> ${escapeHtml(text)}`;
        el.className = 'text-slate-400 text-xs flex items-center gap-1.5 font-medium px-2.5 py-1 bg-slate-900 rounded-lg border border-slate-800';
    }
}

let isGeminiWvVisible = false;

function toggleGeminiViewMode() {
    isGeminiWvVisible = !isGeminiWvVisible;
    const dash = document.getElementById('gemini-chrome-dashboard');
    const wvCont = document.getElementById('gemini-wv-container');
    const btn = document.getElementById('btn-toggle-gemini-mode');

    if (isGeminiWvVisible) {
        if (dash) dash.classList.add('hidden');
        if (wvCont) wvCont.classList.remove('hidden');
        if (btn) btn.innerHTML = `<i data-lucide="monitor" class="w-3.5 h-3.5"></i> Bảng Điều Khiển Chrome`;
    } else {
        if (dash) dash.classList.remove('hidden');
        if (wvCont) wvCont.classList.add('hidden');
        if (btn) btn.innerHTML = `<i data-lucide="layout" class="w-3.5 h-3.5"></i> Chế độ Webview`;
    }
    lucide.createIcons();
}

async function checkChromeGeminiUI(silent = false) {
    if (!window.electronApi || !window.electronApi.checkChromeGemini) return false;
    try {
        const res = await window.electronApi.checkChromeGemini();
        if (res.active) {
            updateGeminiStatusUI('Đã kết nối Chrome (Cổng 9222)', 'connected');
            if (!silent) showToast('Đã kết nối thành công với Google Chrome!', 'success');
        } else {
            updateGeminiStatusUI('Chrome chưa bật (Bấm nút để mở)', 'ready');
            if (!silent) showToast('Chưa phát hiện Google Chrome trên cổng 9222. Hãy bấm "Mở Google Chrome Gemini".', 'info');
        }
        return res.active;
    } catch (e) {
        updateGeminiStatusUI('Lỗi kiểm tra Chrome', 'error');
        if (!silent) showToast('Lỗi kiểm tra Chrome: ' + e.message, 'error');
        return false;
    }
}

async function launchChromeGeminiUI() {
    if (!window.electronApi || !window.electronApi.launchChromeGemini) return;
    updateGeminiStatusUI('Đang mở Google Chrome...', 'busy');
    showToast('Đang khởi chạy Google Chrome... Hãy đăng nhập Google và mở cuộc trò chuyện Gemini của bạn!', 'info');

    try {
        const res = await window.electronApi.launchChromeGemini();
        if (res.success) {
            showToast(res.message || 'Đã mở Google Chrome thành công!', 'success');
            setTimeout(async () => {
                await checkChromeGeminiUI(true);
            }, 3000);
        } else {
            showToast(res.message || 'Không thể mở Chrome', 'error');
            updateGeminiStatusUI('Không thể mở Chrome', 'error');
        }
    } catch (e) {
        showToast('Lỗi: ' + e.message, 'error');
        updateGeminiStatusUI('Lỗi mở Chrome', 'error');
    }
}

async function testChromeGeminiUI() {
    updateGeminiStatusUI('Đang gửi tin thử sang Chrome...', 'busy');
    showToast('Đang gửi tin thử sang Google Chrome Gemini...', 'info');

    try {
        const samplePrompt = 'Viết lại tin BĐS ngắn gọn 3 dòng kèm hashtag: Cho thuê căn hộ studio 35m2 full nội thất view Landmark 81 Bình Thạnh giá 7.5 triệu/tháng liên hệ 0901234567';
        const res = await window.electronApi.testChromeGemini(samplePrompt);
        if (res.success && res.text) {
            updateGeminiStatusUI('Chrome Gemini phản hồi tốt!', 'connected');
            showToast('Chrome Gemini đã phản hồi thành công!', 'success');
            alert('🎉 Kết quả phản hồi từ Google Chrome Gemini Web:\n\n' + res.text);
        } else {
            updateGeminiStatusUI('Lỗi phản hồi từ Chrome', 'error');
            showToast(res.error || 'Chrome Gemini chưa phản hồi', 'error');
            alert('⚠️ Thông báo từ hệ thống:\n\n' + (res.error || 'Chrome Gemini chưa sẵn sàng. Hãy bấm "Mở Google Chrome Gemini", đăng nhập và mở tab gemini.google.com.'));
        }
    } catch (e) {
        updateGeminiStatusUI('Lỗi gửi tin', 'error');
        showToast('Lỗi: ' + e.message, 'error');
    }
}

async function captureActiveChromeGeminiUrlUI() {
    showToast('Đang kết nối Chrome để lấy link cuộc trò chuyện...', 'info');
    try {
        const res = await window.electronApi.getActiveGeminiUrl();
        if (res.success && res.url) {
            const urlInput = document.getElementById('cfg-gemini-conversation-url');
            if (urlInput) urlInput.value = res.url;
            await savePinnedChatConfigUI();
            showToast(`Đã lưu cuộc trò chuyện: "${res.title || res.url}"!`, 'success');
        } else {
            showToast(res.error || 'Chưa tìm thấy cuộc trò chuyện nào trong Chrome', 'error');
            alert('⚠️ ' + (res.error || 'Vui lòng mở Google Chrome, bấm vào cuộc trò chuyện đã ghim của bạn rồi bấm nút này lại!'));
        }
    } catch (e) {
        showToast('Lỗi: ' + e.message, 'error');
    }
}

async function savePinnedChatConfigUI() {
    const url = document.getElementById('cfg-gemini-conversation-url')?.value?.trim() || '';
    const isRaw = document.getElementById('cfg-gemini-send-raw-content')?.checked ? '1' : '0';

    await window.electronApi.saveSettings({
        gemini_conversation_url: url,
        gemini_send_raw_content: isRaw
    });
    if (state.settings) {
        state.settings.gemini_conversation_url = url;
        state.settings.gemini_send_raw_content = isRaw;
    }
    showToast('Đã lưu cấu hình cuộc trò chuyện đã ghim!', 'success');
}

async function runInteractiveChromeTestUI() {
    const inputEl = document.getElementById('chrome-test-input');
    const resultEl = document.getElementById('chrome-test-result');
    const btn = document.getElementById('btn-run-chrome-test');

    const content = inputEl?.value?.trim();
    if (!content) {
        showToast('Vui lòng nhập nội dung tin nhắn thử nghiệm', 'warning');
        return;
    }

    const targetUrl = document.getElementById('cfg-gemini-conversation-url')?.value?.trim() || null;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Đang gửi vào Chrome & đợi AI trả lời...`;
    }
    if (resultEl) {
        resultEl.innerHTML = `<span class="text-amber-400 italic">Đang gửi nội dung sang Chrome Gemini... Vui lòng đợi trong giây lát...</span>`;
    }

    try {
        const res = await window.electronApi.testChromeGemini({ prompt: content, targetUrl });
        if (res.success && res.text) {
            if (resultEl) {
                resultEl.textContent = res.text;
            }
            if (res.finalUrl && (res.finalUrl.includes('/app/') || res.finalUrl.includes('/gem/'))) {
                const urlInput = document.getElementById('cfg-gemini-conversation-url');
                if (urlInput && urlInput.value !== res.finalUrl) {
                    urlInput.value = res.finalUrl;
                }
            }
            showToast('AI Chrome Gemini đã biên tập xong!', 'success');
        } else {
            if (resultEl) {
                resultEl.innerHTML = `<span class="text-rose-400 font-bold">Lỗi: ${escapeHtml(res.error || 'Không nhận được kết quả')}</span>`;
            }
            showToast(res.error || 'Lỗi khi lấy dữ liệu từ Chrome Gemini', 'error');
        }
    } catch (e) {
        if (resultEl) {
            resultEl.innerHTML = `<span class="text-rose-400 font-bold">Lỗi: ${escapeHtml(e.message)}</span>`;
        }
        showToast('Lỗi: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Gửi Vào Chrome Gemini & Xem Kết Quả`;
            lucide.createIcons();
        }
    }
}

function reloadGeminiWebview() {
    const wv = document.getElementById('gemini-wv');
    if (wv) {
        wv.reload();
        showToast('Đang tải lại Gemini Web...', 'info');
    }
}

function loadGeminiHome() {
    const wv = document.getElementById('gemini-wv');
    if (wv) {
        wv.loadURL('https://gemini.google.com');
        showToast('Đang chuyển về trang chủ Gemini Web...', 'info');
    }
}

function openAiApiSettingsModal() {
    const modal = document.getElementById('ai-config-modal');
    if (modal) modal.classList.remove('hidden');
    loadAiSettings();
}

function closeAiApiSettingsModal() {
    const modal = document.getElementById('ai-config-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Tự động gửi tin thô vào cuộc trò chuyện Gemini Web đang mở,
 * chờ AI sinh bài xong và trích xuất nội dung bài đăng Facebook.
 */
async function rewriteWithGeminiWeb(rawContent) {
    const wv = document.getElementById('gemini-wv');
    if (!wv) throw new Error('Không tìm thấy khung Gemini Web');

    updateGeminiStatusUI('Đang kiểm tra cuộc trò chuyện...', 'busy');

    // 1. Kiểm tra trạng thái đăng nhập & ô nhập liệu trên Gemini Web
    const checkState = await wv.executeJavaScript(`
        (function() {
            var url = window.location.href;
            if (url.indexOf('accounts.google.com') !== -1) {
                return { ok: false, reason: 'Chưa đăng nhập tài khoản Google trên Gemini Web' };
            }
            var selectors = [
                'rich-textarea p',
                'rich-textarea div[contenteditable="true"]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'textarea[aria-label*="prompt"]',
                '[data-placeholder]'
            ];
            var found = false;
            for (var i = 0; i < selectors.length; i++) {
                if (document.querySelector(selectors[i])) { found = true; break; }
            }
            return { ok: found, reason: found ? '' : 'Không tìm thấy ô nhập chat Gemini Web' };
        })();
    `);

    if (!checkState.ok) {
        updateGeminiStatusUI(checkState.reason, 'error');
        throw new Error(checkState.reason);
    }

    // 2. Đếm số lượng phản hồi hiện có để nhận biết phản hồi mới sau khi gửi
    const initialResponsesCount = await wv.executeJavaScript(`
        (function() {
            var els = document.querySelectorAll('message-content, .model-response-text, .response-container-content, [class*="response-content"]');
            return els.length;
        })();
    `);

    updateGeminiStatusUI('Đang dán tin nhắn vào Gemini Web...', 'busy');

    // 3. Tiêm nội dung tin nhắn và bấm Gửi
    const injectSuccess = await wv.executeJavaScript(`
        (function() {
            var text = ${JSON.stringify(rawContent)};
            var selectors = [
                'rich-textarea p',
                'rich-textarea div[contenteditable="true"]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'textarea[aria-label*="prompt"]',
                '[data-placeholder]'
            ];
            var el = null;
            for (var i = 0; i < selectors.length; i++) {
                var candidate = document.querySelector(selectors[i]);
                if (candidate) { el = candidate; break; }
            }
            if (!el) return false;

            el.focus();
            try {
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, text);
            } catch (err) {
                el.innerText = text;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));

            // Kích hoạt nút gửi
            setTimeout(function() {
                var sendBtn = document.querySelector('button[aria-label*="Gửi"], button[aria-label*="Send"], button.send-button, .send-button-container button');
                if (sendBtn && !sendBtn.disabled) {
                    sendBtn.click();
                } else {
                    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                }
            }, 300);

            return true;
        })();
    `);

    if (!injectSuccess) {
        updateGeminiStatusUI('Không thể dán tin nhắn vào chat', 'error');
        throw new Error('Không thể đưa tin nhắn vào khung chat Gemini');
    }

    updateGeminiStatusUI('Gemini đang suy nghĩ & sinh bài...', 'busy');

    // 4. Lắng nghe và đợi Gemini Web sinh văn bản hoàn tất (tối đa 40 giây)
    let lastSeenText = '';
    let stableIterations = 0;
    let finalResult = '';

    for (let round = 0; round < 25; round++) {
        await new Promise(r => setTimeout(r, 1600));

        const pollData = await wv.executeJavaScript(`
            (function() {
                var stopBtn = document.querySelector('button[aria-label*="Dừng"], button[aria-label*="Stop"], button.stop-button, [aria-label*="dừng"]');
                var isGenerating = !!stopBtn;

                var els = document.querySelectorAll('message-content, .model-response-text, .response-container-content, [class*="response-content"]');
                var latestText = '';
                if (els.length > 0) {
                    var lastEl = els[els.length - 1];
                    latestText = (lastEl.innerText || lastEl.textContent || '').trim();
                }

                return {
                    count: els.length,
                    isGenerating: isGenerating,
                    text: latestText
                };
            })();
        `);

        if (pollData.text && (pollData.count > initialResponsesCount || pollData.text.length > 50)) {
            if (pollData.text === lastSeenText && !pollData.isGenerating) {
                stableIterations++;
                if (stableIterations >= 2) {
                    finalResult = pollData.text;
                    break;
                }
            } else {
                lastSeenText = pollData.text;
                stableIterations = 0;
            }
        }
    }

    if (!finalResult) {
        finalResult = lastSeenText;
    }

    if (!finalResult || finalResult.length < 30) {
        updateGeminiStatusUI('Không nhận được phản hồi từ Gemini Web', 'error');
        throw new Error('Gemini Web chưa phản hồi hoặc phản hồi quá ngắn');
    }

    updateGeminiStatusUI('Đã nhận bài viết thành công!', 'ready');

    // Bổ sung chữ ký nếu chưa có
    if (state.settings?.custom_signature && !finalResult.includes(state.settings.custom_signature)) {
        finalResult += '\n\n' + state.settings.custom_signature;
    }
    if (state.settings?.custom_hashtags && !finalResult.includes(state.settings.custom_hashtags)) {
        finalResult += '\n\n' + state.settings.custom_hashtags;
    }

    return finalResult;
}

// Thử nghiệm gửi tin nhắn mẫu vào Gemini Web
async function testGeminiWebChatUI() {
    switchTab('ai');
    showToast('Đang gửi tin thử nghiệm vào Gemini Web...', 'info');
    const sample = 'Bán gấp căn hộ 2PN 70m2 chung cư Sunrise City, Q7. Giá 3.8 tỷ có thương lượng. Full nội thất cao cấp, view Landmark 81. LH: 0354084364 (Chính chủ)';
    try {
        const res = await rewriteWithGeminiWeb(sample);
        if (res) {
            showToast('Gemini Web đã phản hồi thành công!', 'success');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// Viết lại 1 bài bằng AI Gemini trực tiếp từ giao diện (Ưu tiên Google Chrome Gemini -> Tự động dự phòng API)
async function reRewritePostUI(id) {
    const btn = document.getElementById(`btn-ai-rewrite-${id}`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-amber-400"></i> Đang viết...`;
    }

    showToast(`Đang dùng AI Gemini viết lại bài #${id}...`, 'info');
    try {
        const res = await window.electronApi.reRewritePost(id);
        if (res.success) {
            showToast(`AI đã biên tập lại bài #${id} thành công!`, 'success');
        } else {
            showToast(res.error || 'Lỗi khi AI viết lại bài', 'error');
        }
    } catch (e) {
        showToast(e.message, 'error');
    }

    await loadPosts();
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-400"></i> Viết lại AI`;
        lucide.createIcons();
    }
}

// 3. Zalo Webview Controls
function updateZaloActiveGroupDisplay() {
    const el = document.getElementById('zalo-active-group-name');
    if (el) {
        el.innerText = state.activeZaloGroup || 'Chưa chọn hội thoại';
    }
}

async function monitorCurrentZaloGroup() {
    if (!state.activeZaloGroup) {
        showToast('Vui lòng nhấp vào nhóm Zalo bạn muốn theo dõi trên màn hình Zalo trước!', 'error');
        return;
    }
    const res = await window.electronApi.addZaloGroup(state.activeZaloGroup);
    if (res.success) {
        showToast(`Đã thêm nhóm [${state.activeZaloGroup}] vào danh sách tự động bắt tin!`, 'success');
        await loadZaloGroups();
    } else {
        showToast(res.error, 'error');
    }
}

function reloadZaloWebview() {
    const wv = document.getElementById('zalo-wv');
    if (wv) wv.reload();
}

// Quản Lý Nhóm Zalo Theo Dõi
async function loadZaloGroups() {
    try {
        const res = await window.electronApi.getZaloGroups();
        if (res.success) {
            state.zaloGroups = res.groups;
            renderZaloGroupsTable();
        }
    } catch (e) {
        console.error('Error loadZaloGroups:', e);
    }
}

function renderZaloGroupsTable(filterText = '') {
    const list = state.zaloGroups || [];
    let filtered = list;
    if (filterText) {
        filtered = list.filter(g => g.name.toLowerCase().includes(filterText.toLowerCase()));
    }

    // 1. Render trong Tab Quản Lý Nhóm Zalo chính
    const mainTbody = document.getElementById('zalo-groups-main-table-body');
    if (mainTbody) {
        if (filtered.length === 0) {
            mainTbody.innerHTML = `
                <tr>
                    <td colspan="4" class="p-8 text-center text-slate-500 text-xs">
                        <div class="mb-3">Chưa có nhóm Zalo nào trong danh sách theo dõi.</div>
                        <button onclick="triggerZaloGroupScan()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 shadow-sm transition-all">
                            <i data-lucide="scan" class="w-4 h-4"></i> Bấm Vào Đây Để Quét Tự Động Từ Zalo Web
                        </button>
                    </td>
                </tr>
            `;
        } else {
            mainTbody.innerHTML = filtered.map(g => `
                <tr class="hover:bg-slate-900/50 transition-colors">
                    <td class="p-3.5 text-center">
                        <input type="checkbox" ${g.is_monitored ? 'checked' : ''} onchange="toggleZaloGroupStatus(${g.id})" class="w-4 h-4 rounded text-blue-600 bg-slate-800 border-slate-700 cursor-pointer">
                    </td>
                    <td class="p-3.5 font-bold text-white">
                        ${escapeHtml(g.name)}
                    </td>
                    <td class="p-3.5 text-center">
                        <span class="px-2.5 py-1 rounded-full text-[10px] font-semibold ${g.is_monitored ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60' : 'bg-slate-800 text-slate-400'}">
                            ${g.is_monitored ? '● Đang theo dõi bắt tin' : '○ Tạm tắt'}
                        </span>
                    </td>
                    <td class="p-3.5 text-right">
                        <button onclick="deleteZaloGroupRow(${g.id})" class="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors" title="Xóa nhóm">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    }

    // 2. Render trong Modal (nếu có)
    const modalTbody = document.getElementById('zalo-groups-table-body');
    if (modalTbody) {
        if (filtered.length === 0) {
            modalTbody.innerHTML = `
                <tr>
                    <td colspan="3" class="p-6 text-center text-slate-500 text-xs">
                        Chưa có nhóm Zalo nào. Bấm <b>"Quét Tự Động"</b> để nạp toàn bộ nhóm từ Zalo Web.
                    </td>
                </tr>
            `;
        } else {
            modalTbody.innerHTML = filtered.map(g => `
                <tr class="hover:bg-slate-900/50 transition-colors">
                    <td class="p-3 text-center">
                        <input type="checkbox" ${g.is_monitored ? 'checked' : ''} onchange="toggleZaloGroupStatus(${g.id})" class="w-4 h-4 rounded text-blue-600 bg-slate-800 border-slate-700 cursor-pointer">
                    </td>
                    <td class="p-3 font-semibold text-white">
                        ${escapeHtml(g.name)}
                    </td>
                    <td class="p-3 text-right">
                        <button onclick="deleteZaloGroupRow(${g.id})" class="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors" title="Xóa">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    }

    // Cập nhật số đếm badge
    const activeCount = list.filter(g => g.is_monitored).length;
    const countEl = document.getElementById('zalo-groups-count');
    if (countEl) countEl.innerText = activeCount;
    const badge = document.getElementById('badge-zalo-groups-count');
    if (badge) {
        if (activeCount > 0) {
            badge.innerText = activeCount;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    lucide.createIcons();
}

function filterZaloGroupsTable() {
    const q = document.getElementById('zalo-group-search')?.value || '';
    renderZaloGroupsTable(q);
}

function openZaloGroupsModal() {
    const modal = document.getElementById('zalo-groups-modal');
    if (modal) {
        modal.classList.remove('hidden');
        renderZaloGroupsTable();
    }
}

function closeZaloGroupsModal() {
    const modal = document.getElementById('zalo-groups-modal');
    if (modal) modal.classList.add('hidden');
}

async function toggleZaloGroupStatus(id) {
    await window.electronApi.toggleZaloGroup(id);
    await loadZaloGroups();
}

async function toggleAllZaloGroupsUI(isMonitored) {
    try {
        await window.electronApi.toggleAllZaloGroups(isMonitored);
        showToast(isMonitored ? 'Đã bật theo dõi tất cả nhóm Zalo!' : 'Đã tắt theo dõi tất cả nhóm Zalo.', 'info');
        await loadZaloGroups();
    } catch (e) {
        showToast('Lỗi khi đổi trạng thái nhóm Zalo: ' + e.message, 'error');
    }
}

async function deleteZaloGroupRow(id) {
    try {
        await window.electronApi.deleteZaloGroup(id);
        await loadZaloGroups();
    } catch (e) {
        console.error('Error deleteZaloGroupRow:', e);
    }
}

async function clearAllZaloGroupsUI() {
    try {
        await window.electronApi.clearAllZaloGroups();
        showToast('Đã xóa sạch toàn bộ danh sách nhóm Zalo!', 'info');
        await loadZaloGroups();
    } catch (e) {
        showToast('Lỗi khi xóa tất cả: ' + e.message, 'error');
    }
}

async function addNewZaloGroupManual() {
    const input = document.getElementById('add-zalo-group-name');
    const name = input?.value?.trim();
    if (!name) {
        showToast('Vui lòng nhập tên nhóm Zalo!', 'error');
        return;
    }
    const res = await window.electronApi.addZaloGroup(name);
    if (res.success) {
        showToast(`Đã thêm nhóm: ${name}`, 'success');
        input.value = '';
        await loadZaloGroups();
    } else {
        showToast(res.error, 'error');
    }
}

async function openAddZaloGroupManual() {
    const name = prompt('Nhập tên nhóm Zalo bạn muốn theo dõi:');
    if (!name?.trim()) return;
    const res = await window.electronApi.addZaloGroup(name.trim());
    if (res.success) {
        showToast(`Đã thêm nhóm: ${name.trim()}`, 'success');
        await loadZaloGroups();
    } else {
        showToast(res.error, 'error');
    }
}

function openBulkAddZaloModal() {
    const modal = document.getElementById('zalo-bulk-add-modal');
    if (modal) {
        modal.classList.remove('hidden');
        const input = document.getElementById('bulk-zalo-groups-input');
        if (input) {
            input.value = '';
            input.focus();
        }
        if (window.lucide) lucide.createIcons();
    }
}

function closeBulkAddZaloModal() {
    const modal = document.getElementById('zalo-bulk-add-modal');
    if (modal) modal.classList.add('hidden');
}

async function submitBulkZaloGroups() {
    const input = document.getElementById('bulk-zalo-groups-input');
    const raw = input?.value || '';
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length >= 2);
    if (lines.length === 0) {
        showToast('Vui lòng nhập ít nhất một tên nhóm Zalo!', 'error');
        return;
    }

    try {
        const res = await window.electronApi.addZaloGroupsBulk(lines);
        if (res.success) {
            showToast(`✅ Đã thêm thành công ${res.added} nhóm mới (${res.count} tổng số)!`, 'success');
            closeBulkAddZaloModal();
            await loadZaloGroups();
        } else {
            showToast('Lỗi: ' + res.error, 'error');
        }
    } catch (e) {
        showToast('Lỗi khi thêm nhóm: ' + e.message, 'error');
    }
}

// QUÉT CHUYÊN SÂU MỤC "KHÁC" (NHỮNG NHÓM ĐÃ CHUYỂN QUA TAB KHÁC NHƯ TRÊN ẢNH)
async function triggerZaloKhacScan() {
    const wv = document.getElementById('zalo-wv');
    if (!wv) return;

    // Đảm bảo tab Zalo Web đang hiển thị trực tiếp để Chromium render layout đầy đủ
    if (state.currentTab !== 'zalo') {
        switchTab('zalo');
        await new Promise(r => setTimeout(r, 350));
    }

    showScanModal('Zalo', 'Đang Quét Các Nhóm Trong Mục "Khác"...');
    appendScanModalLog('Kiểm tra tab "Khác" trên Zalo Web...');

    try {
        const currentUrl = wv.getURL();
        if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('zalo.me')) {
            updateScanModalStatus('⚠️ Chưa mở Zalo Web', 100);
            appendScanModalLog('Lỗi: Bạn chưa mở Zalo Web.');
            showToast('Vui lòng mở và đăng nhập Zalo Web trước!', 'error');
            setTimeout(closeScanModal, 2000);
            return;
        }

        updateScanModalStatus('Đang định vị mục "Khác" và quét danh sách nhóm...', 35);

        const scanResult = await wv.executeJavaScript(`
            (async function() {
                var names = [];
                var seen = {};

                function isValidGroupName(str) {
                    if (!str || str.length < 2) return false;
                    // Bỏ qua nếu là timestamp (10:30, 2 ngày trước, etc.)
                    if (/^\\d{1,2}:\\d{2}$/.test(str)) return false;
                    if (/^\\d+\\s*(ngày|giờ|phút|giây|tháng)/.test(str)) return false;
                    var lower = str.toLowerCase().trim();
                    var systemWords = ['ưu tiên', 'khác', 'zalo', 'cloud của tôi', 'truyền file', 'hôm qua', 'vừa xong', 'đã gửi', 'tin nhắn', 'danh bạ', 'tin nhắn từ người lạ', 'tìm kiếm'];
                    if (systemWords.indexOf(lower) !== -1) return false;
                    // Bỏ qua nếu là tiền tố tin nhắn
                    if (/^(tin nhắn|hình ảnh|nhãn dán|video|tệp tin|bạn:|\\w+:)/i.test(lower)) return false;
                    // Không lấy nếu là tin nhắn quá dài (thường tên nhóm không dài quá 90 ký tự)
                    if (str.length > 90) return false;
                    return true;
                }

                function extractNameFromRow(row) {
                    // Tuyệt đối không lấy thẻ con của conv-message (chứa tin nhắn gần nhất)
                    var titleEl = row.querySelector('.conv-item-title__more, [class*="conv-item-title__more"], [class*="conv-item-title"], [data-id="chat-title"]');
                    if (titleEl && titleEl.innerText && titleEl.innerText.trim()) {
                        var t = titleEl.innerText.trim().split('\\n')[0].replace(/\\u00A0/g, ' ').trim();
                        // Bỏ số thành viên nếu có ví dụ: "Nhóm BĐS (150)" -> "Nhóm BĐS"
                        t = t.replace(/\\s*\\(\\d+\\s*thành viên\\)/gi, '').replace(/\\s*\\(\\d+\\)/g, '').trim();
                        if (isValidGroupName(t)) return t;
                    }

                    // Thử thuộc tính title trên row hoặc titleEl
                    var titleAttr = (titleEl && titleEl.getAttribute('title')) || row.getAttribute('title');
                    if (titleAttr && isValidGroupName(titleAttr.trim())) {
                        return titleAttr.trim().split('\\n')[0].replace(/\\u00A0/g, ' ').trim();
                    }

                    // Thử phần tử đầu tiên trong body trước khi tới conv-message
                    var body = row.querySelector('.conv-item-body, [class*="conv-item-body"]');
                    if (body && body.firstElementChild) {
                        var first = body.firstElementChild.innerText.trim().split('\\n')[0].replace(/\\u00A0/g, ' ').trim();
                        if (isValidGroupName(first)) return first;
                    }

                    return '';
                }

                // BƯỚC 1: Bấm vào tab "Khác" trên thanh phân loại nếu chưa chọn
                try {
                    var allSpans = Array.from(document.querySelectorAll('div, span, button, a, [role="tab"]'));
                    for (var i = 0; i < allSpans.length; i++) {
                        var el = allSpans[i];
                        if (el.children.length === 0 && el.innerText && el.innerText.trim().toLowerCase() === 'khác') {
                            var r = el.getBoundingClientRect();
                            if (r.left >= 50 && r.left <= 420 && r.top <= 160) {
                                el.click();
                                if (el.parentElement) el.parentElement.click();
                                await new Promise(function(r) { setTimeout(r, 600); });
                                break;
                            }
                        }
                    }
                } catch(e) {}

                // BƯỚC 2: Tìm container cuộn danh sách hội thoại bên trái (KHÔNG BAO GIỜ LẤY KHUNG CHAT BÊN PHẢI)
                var scrollContainer = null;
                var firstConv = document.querySelector('.conv-item, [id^="conv-item-"], [data-id*="conv_item"]');
                if (firstConv) {
                    var p = firstConv.parentElement;
                    while (p && p !== document.body) {
                        var s = window.getComputedStyle(p);
                        var rect = p.getBoundingClientRect();
                        // Cột danh sách hội thoại luôn có left < 150 và right <= 460
                        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.clientHeight > 100 && rect.left < 150 && rect.right <= 460) {
                            scrollContainer = p;
                            break;
                        }
                        p = p.parentElement;
                    }
                }

                // Fallback nếu không qua parent: tìm div scroll ở đúng tọa độ cột trái
                if (!scrollContainer) {
                    var allDivs = document.querySelectorAll('div, ul, section');
                    for (var d = 0; d < allDivs.length; d++) {
                        var el = allDivs[d];
                        var rect = el.getBoundingClientRect();
                        if (rect.left >= 40 && rect.left <= 100 && rect.right <= 450 && rect.height > 150) {
                            var s = window.getComputedStyle(el);
                            if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
                                scrollContainer = el;
                                break;
                            }
                        }
                    }
                }

                // BƯỚC 3: Thu hoạch các nhóm hiển thị
                function harvestVisible() {
                    var root = scrollContainer || document;
                    // Chỉ tìm conv-item nằm trong cột bên trái (rect.left < 450)
                    var items = Array.from(root.querySelectorAll('.conv-item, [id^="conv-item-"], [data-id*="conv_item"]')).filter(function(it) {
                        var r = it.getBoundingClientRect();
                        return r.left < 450 && r.height >= 40;
                    });

                    for (var k = 0; k < items.length; k++) {
                        var name = extractNameFromRow(items[k]);
                        if (name) {
                            var key = name.toLowerCase();
                            if (!seen[key]) {
                                seen[key] = true;
                                names.push(name);
                            }
                        }
                    }
                }

                // Đưa danh sách hội thoại lên đầu
                if (scrollContainer) scrollContainer.scrollTop = 0;
                await new Promise(function(r) { setTimeout(r, 300); });
                harvestVisible();

                // BƯỚC 4: Cuộn 25 bước chỉ trong container danh sách hội thoại bên trái
                var maxSteps = 25;
                for (var step = 1; step <= maxSteps; step++) {
                    if (scrollContainer) {
                        scrollContainer.scrollTop += 350;
                        await new Promise(function(r) { setTimeout(r, 220); });
                        harvestVisible();
                    } else {
                        break;
                    }
                }

                return {
                    groups: names
                };
            })();
        `);

        const groups = scanResult?.groups || [];
        appendScanModalLog(`Đã quét xong mục "Khác"! Tìm thấy ${groups.length} nhóm.`);
        updateScanModalStatus(`Đã thu thập ${groups.length} nhóm từ mục "Khác"...`, 85, groups.length);

        if (groups.length > 0) {
            groups.slice(0, 5).forEach((g, idx) => {
                appendScanModalLog(`  [${idx + 1}] ${g}`);
            });
            if (groups.length > 5) {
                appendScanModalLog(`  ... và ${groups.length - 5} nhóm khác.`);
            }

            const res = await window.electronApi.addZaloGroupsBulk(groups);
            if (window.electronApi.addLog) {
                await window.electronApi.addLog('info', `[Zalo Scanner] Đã quét thành công ${groups.length} nhóm từ mục "Khác": ${groups.join(', ')}`);
            }
            appendScanModalLog(`✅ Đã lưu ${res.count} nhóm vào danh sách theo dõi (Thêm mới: ${res.added}).`);
            updateScanModalStatus('Hoàn tất quét mục "Khác"!', 100, groups.length);
            showToast(`✅ Đã quét thành công ${groups.length} nhóm: ${groups.slice(0, 3).join(', ')}${groups.length > 3 ? '...' : ''}!`, 'success');
            await loadZaloGroups();
            setTimeout(() => {
                closeScanModal();
                switchTab('zalo-groups');
            }, 1500);
        } else {
            appendScanModalLog('⚠️ Không tìm thấy nhóm nào trong mục "Khác".');
            updateScanModalStatus('Không có nhóm trong mục Khác', 100, 0);
            showToast('Không tìm thấy nhóm trong mục "Khác". Vui lòng kiểm tra lại Zalo Web xem đã có nhóm trong tab Khác chưa nhé!', 'warning');
            setTimeout(closeScanModal, 3000);
        }
    } catch (e) {
        console.error('Error triggerZaloKhacScan:', e);
        appendScanModalLog('Lỗi khi quét mục "Khác": ' + e.message);
        updateScanModalStatus('Lỗi khi quét!', 100);
        showToast('Lỗi quét mục "Khác": ' + e.message, 'error');
        setTimeout(closeScanModal, 3000);
    }
}

// QUÉT RIÊNG MỤC / THẺ PHÂN LOẠI ĐANG MỞ TRÊN ZALO WEB (CỰC KỲ CHÍNH XÁC, KHÔNG BỊ SÓT)
async function triggerZaloCurrentViewScan() {
    const wv = document.getElementById('zalo-wv');
    if (!wv) return;

    showScanModal('Zalo', 'Đang Quét Thẻ / Mục Zalo Đang Mở...');
    appendScanModalLog('Kiểm tra mục phân loại hoặc tab hội thoại đang hiển thị trên Zalo Web...');

    try {
        const currentUrl = wv.getURL();
        if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('zalo.me')) {
            updateScanModalStatus('⚠️ Chưa mở Zalo Web', 100);
            appendScanModalLog('Lỗi: Bạn chưa mở Zalo Web.');
            showToast('Vui lòng vào tab Zalo Web, đăng nhập và chọn thẻ/mục cần quét trước!', 'error');
            setTimeout(closeScanModal, 2000);
            return;
        }

        updateScanModalStatus('Đang quét danh sách hội thoại trong mục hiện tại...', 35);

        // Chạy trực tiếp trên view hiện tại, không chuyển tab Danh bạ
        const scanResult = await wv.executeJavaScript(`
            (async function() {
                var detectedCategory = 'Mục hiện tại';
                try {
                    var activeTag = document.querySelector('.sub-tab-item.active, .category-item.selected, [class*="tab-item"][class*="active"], [class*="tag-item"][class*="selected"], [class*="filter-item"][class*="active"], div[class*="label-filter"] .active, div[class*="tab--active"]');
                    if (activeTag && activeTag.innerText && activeTag.innerText.trim()) {
                        detectedCategory = activeTag.innerText.trim();
                    }
                } catch(e) {}

                var names = [];
                var seen = {};

                function isValidGroupName(str) {
                    if (!str || str.length < 2) return false;
                    if (/^\\d{1,2}:\\d{2}$/.test(str)) return false;
                    if (/^\\d+\\s*(ngày|giờ|phút|giây|tháng)/.test(str)) return false;
                    var lower = str.toLowerCase().trim();
                    var systemWords = ['ưu tiên', 'khác', 'zalo', 'cloud của tôi', 'truyền file', 'hôm qua', 'vừa xong', 'đã gửi', 'tin nhắn', 'danh bạ', 'tin nhắn từ người lạ', 'tìm kiếm'];
                    if (systemWords.indexOf(lower) !== -1) return false;
                    if (/^(tin nhắn|hình ảnh|nhãn dán|video|tệp tin|bạn:|\\w+:)/i.test(lower)) return false;
                    if (str.length > 90) return false;
                    return true;
                }

                function extractNameFromRow(row) {
                    var titleEl = row.querySelector('.conv-item-title__more, [class*="conv-item-title__more"], [class*="conv-item-title"], [data-id="chat-title"]');
                    if (titleEl && titleEl.innerText && titleEl.innerText.trim()) {
                        var t = titleEl.innerText.trim().split('\\n')[0].replace(/\\u00A0/g, ' ').trim();
                        t = t.replace(/\\s*\\(\\d+\\s*thành viên\\)/gi, '').replace(/\\s*\\(\\d+\\)/g, '').trim();
                        if (isValidGroupName(t)) return t;
                    }
                    var titleAttr = (titleEl && titleEl.getAttribute('title')) || row.getAttribute('title');
                    if (titleAttr && isValidGroupName(titleAttr.trim())) {
                        return titleAttr.trim().split('\\n')[0].replace(/\\u00A0/g, ' ').trim();
                    }
                    return '';
                }

                var scrollContainer = null;
                var firstConv = document.querySelector('.conv-item, [id^="conv-item-"], [data-id*="conv_item"]');
                if (firstConv) {
                    var p = firstConv.parentElement;
                    while (p && p !== document.body) {
                        var s = window.getComputedStyle(p);
                        var rect = p.getBoundingClientRect();
                        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.clientHeight > 100 && rect.left < 150 && rect.right <= 460) {
                            scrollContainer = p;
                            break;
                        }
                        p = p.parentElement;
                    }
                }

                function harvestVisible() {
                    var root = scrollContainer || document;
                    var items = Array.from(root.querySelectorAll('.conv-item, [id^="conv-item-"], [data-id*="conv_item"]')).filter(function(it) {
                        var r = it.getBoundingClientRect();
                        return r.left < 450 && r.height >= 40;
                    });
                    for (var k = 0; k < items.length; k++) {
                        var name = extractNameFromRow(items[k]);
                        if (name) {
                            var key = name.toLowerCase();
                            if (!seen[key]) {
                                seen[key] = true;
                                names.push(name);
                            }
                        }
                    }
                }

                if (scrollContainer) scrollContainer.scrollTop = 0;
                await new Promise(function(r) { setTimeout(r, 250); });
                harvestVisible();

                var maxSteps = 20;
                for (var step = 1; step <= maxSteps; step++) {
                    if (scrollContainer) {
                        scrollContainer.scrollTop += 350;
                        await new Promise(function(r) { setTimeout(r, 220); });
                        harvestVisible();
                    } else {
                        break;
                    }
                }

                return {
                    category: detectedCategory,
                    groups: names
                };
            })();
        `);

        const catName = scanResult?.category || 'Mục hiện tại';
        const groups = scanResult?.groups || [];

        appendScanModalLog(`Đang ở: "${catName}". Bóc tách được ${groups.length} nhóm/hội thoại.`);
        updateScanModalStatus(`Đã thu thập ${groups.length} nhóm từ "${catName}"...`, 80, groups.length);

        if (groups.length > 0) {
            const res = await window.electronApi.addZaloGroupsBulk(groups);
            appendScanModalLog(`✅ Đã lưu ${res.count} nhóm vào hệ thống (Thêm mới: ${res.added}).`);
            updateScanModalStatus('Hoàn tất quét nhóm mục hiện tại!', 100, groups.length);
            showToast(`✅ Đã quét thành công ${groups.length} nhóm từ "${catName}"!`, 'success');
            await loadZaloGroups();
            setTimeout(closeScanModal, 1500);
        } else {
            appendScanModalLog('⚠️ Không tìm thấy nhóm nào trong mục này. Hãy kiểm tra xem bạn có đang ở đúng tab hội thoại / phân loại không.');
            updateScanModalStatus('Không tìm thấy nhóm', 100, 0);
            showToast('Không tìm thấy nhóm nào trong mục đang mở. Vui lòng mở Zalo Web và chọn đúng danh sách cần quét!', 'warning');
            setTimeout(closeScanModal, 2500);
        }
    } catch (e) {
        console.error('Error triggerZaloCurrentViewScan:', e);
        appendScanModalLog('Lỗi khi quét mục hiện tại: ' + e.message);
        updateScanModalStatus('Lỗi khi quét!', 100);
        showToast('Lỗi quét mục Zalo: ' + e.message, 'error');
        setTimeout(closeScanModal, 3000);
    }
}

// =========================================================================
// HỆ THỐNG QUÉT NHÓM THÔNG MINH CÓ TIẾN TRÌNH TRỰC QUAN & GHI LOG THỜI GIAN THỰC
// =========================================================================
let isScanning = false;
let stopScanRequested = false;

function showScanModal(platform, title) {
    isScanning = true;
    stopScanRequested = false;
    const modal = document.getElementById('scan-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    document.getElementById('scan-modal-title').innerText = title || `Đang Quét Danh Sách Nhóm ${platform}...`;
    const badge = document.getElementById('scan-modal-badge');
    if (badge) {
        badge.innerText = platform;
        if (platform === 'Facebook') {
            badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800';
        } else {
            badge.className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800';
        }
    }

    updateScanModalStatus('Đang khởi tạo kết nối trình duyệt...', 15, 0);
    const logBox = document.getElementById('scan-modal-log');
    if (logBox) {
        logBox.innerHTML = `<div>[${new Date().toLocaleTimeString('vi-VN')}] Khởi chạy tiến trình quét nhóm ${platform}...</div>`;
    }
    lucide.createIcons();
}

function updateScanModalStatus(statusText, percent = null, count = null) {
    const st = document.getElementById('scan-modal-status');
    if (st && statusText) st.innerText = statusText;

    if (percent !== null) {
        const bar = document.getElementById('scan-modal-progress-bar');
        if (bar) bar.style.width = `${Math.min(100, Math.max(5, percent))}%`;
    }

    if (count !== null) {
        const cnt = document.getElementById('scan-modal-counter');
        if (cnt) cnt.innerText = `${count} nhóm`;
    }
}

function appendScanModalLog(msg) {
    const logBox = document.getElementById('scan-modal-log');
    if (logBox) {
        const time = new Date().toLocaleTimeString('vi-VN');
        const div = document.createElement('div');
        div.innerText = `[${time}] ${msg}`;
        logBox.appendChild(div);
        logBox.scrollTop = logBox.scrollHeight;
    }
}

function closeScanModal() {
    isScanning = false;
    const modal = document.getElementById('scan-modal');
    if (modal) modal.classList.add('hidden');
}

function stopScanning() {
    stopScanRequested = true;
    updateScanModalStatus('Đang dừng và lưu lại toàn bộ nhóm đã thu thập...', 100);
    appendScanModalLog('Người dùng bấm dừng quét. Đang tiến hành lưu kết quả...');
}

// 1. TỰ ĐỘNG QUÉT TOÀN DIỆN DANH SÁCH NHÓM ZALO
async function triggerZaloGroupScan() {
    const wv = document.getElementById('zalo-wv');
    if (!wv) return;

    showScanModal('Zalo', 'Đang Quét Danh Sách Nhóm Zalo...');
    appendScanModalLog('Kiểm tra phiên đăng nhập Zalo Web...');

    try {
        const currentUrl = wv.getURL();
        if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('zalo.me')) {
            updateScanModalStatus('Đang mở Zalo Web...', 20);
            appendScanModalLog('Đang tải trang https://chat.zalo.me...');
            wv.loadURL('https://chat.zalo.me');
            showToast('Đang mở Zalo Web... Vui lòng đăng nhập QR trước khi quét!', 'info');
            switchTab('zalo');
            closeScanModal();
            return;
        }

        const isLogin = await wv.executeJavaScript(`
            Boolean(document.querySelector('#qr-container, .qrcode-img, [class*="qrcode"], input[type="text"][placeholder*="Số điện thoại"]'))
        `);
        if (isLogin) {
            updateScanModalStatus('⚠️ Chưa đăng nhập Zalo!', 100);
            appendScanModalLog('Lỗi: Phát hiện màn hình quét mã QR Zalo.');
            if (window.electronApi.addLog) {
                await window.electronApi.addLog('warn', '[Zalo Scanner] Chưa đăng nhập Zalo Web. Cần quét mã QR.');
            }
            showToast('⚠️ Bạn chưa đăng nhập Zalo! Vui lòng quét mã QR trước khi quét nhóm.', 'error');
            switchTab('zalo');
            setTimeout(closeScanModal, 2000);
            return;
        }

        const foundZaloMap = {};
        if (window.electronApi.addLog) {
            await window.electronApi.addLog('info', '[Zalo Scanner] Bắt đầu quét danh sách nhóm từ Zalo Web...');
        }

        // GIAI ĐOẠN 0: Quét siêu tốc từ IndexedDB của Zalo Web (Nếu Zalo đã lưu offline)
        updateScanModalStatus('Đang trích xuất dữ liệu bộ nhớ Zalo Web...', 25);
        appendScanModalLog('Kiểm tra cơ sở dữ liệu IndexedDB của Zalo...');

        try {
            const idbGroups = await wv.executeJavaScript(`
                (async function() {
                    var names = [];
                    try {
                        if (!window.indexedDB || !window.indexedDB.databases) return names;
                        var dbs = await indexedDB.databases();
                        for (var d = 0; d < dbs.length; d++) {
                            var dbInfo = dbs[d];
                            if (!dbInfo || !dbInfo.name) continue;
                            try {
                                var db = await new Promise(function(resolve, reject) {
                                    var req = indexedDB.open(dbInfo.name);
                                    req.onsuccess = function() { resolve(req.result); };
                                    req.onerror = function() { resolve(null); };
                                });
                                if (!db) continue;

                                var storeNames = Array.from(db.objectStoreNames);
                                for (var s = 0; s < storeNames.length; s++) {
                                    var sName = storeNames[s].toLowerCase();
                                    if (sName.indexOf('group') !== -1 || sName.indexOf('conv') !== -1 || sName.indexOf('thread') !== -1) {
                                        var rows = await new Promise(function(resolve) {
                                            try {
                                                var tx = db.transaction(storeNames[s], 'readonly');
                                                var store = tx.objectStore(storeNames[s]);
                                                var reqAll = store.getAll();
                                                reqAll.onsuccess = function() { resolve(reqAll.result || []); };
                                                reqAll.onerror = function() { resolve([]); };
                                            } catch (e) { resolve([]); }
                                        });

                                        for (var r = 0; r < rows.length; r++) {
                                            var item = rows[r];
                                            var gName = item.name || item.groupName || item.title || item.gridName || (item.data && item.data.name);
                                            var isGrp = item.isGroup || item.type === 'group' || item.type === 1 || item.type === 2 || (item.grid && item.grid.length > 0) || (item.id && String(item.id).indexOf('g') === 0);
                                            if (gName && (isGrp || sName.indexOf('group') !== -1)) {
                                                names.push(String(gName).trim());
                                            }
                                        }
                                    }
                                }
                                db.close();
                            } catch(e) {}
                        }
                    } catch(e) {}
                    return names;
                })();
            `);

            if (Array.isArray(idbGroups) && idbGroups.length > 0) {
                for (const name of idbGroups) {
                    const key = name.toLowerCase().trim();
                    if (key.length >= 2 && !foundZaloMap[key]) {
                        foundZaloMap[key] = name.trim();
                    }
                }
                appendScanModalLog(`Trích xuất nhanh từ IndexedDB: tìm thấy ${idbGroups.length} nhóm!`);
                updateScanModalStatus('Đã quét dữ liệu bộ nhớ...', 35, Object.keys(foundZaloMap).length);
            }
        } catch (e) {
            console.warn('Lỗi đọc IndexedDB Zalo:', e);
        }

        // GIAI ĐOẠN 1: Mở Tab Danh Bạ -> Danh Sách Nhóm (Chứa 100% nhóm đã tham gia)
        updateScanModalStatus('Đang mở Danh bạ nhóm trên Zalo Web...', 40);
        appendScanModalLog('Mở tab Danh Bạ -> Danh Sách Nhóm...');

        const openedGroupDirectory = await wv.executeJavaScript(`
            (async function() {
                function robustClick(el) {
                    if (!el) return false;
                    try {
                        el.scrollIntoView({ block: 'center' });
                        ['mousedown', 'mouseup', 'click'].forEach(function(evt) {
                            el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
                        });
                        if (typeof el.click === 'function') el.click();
                        return true;
                    } catch (e) { return false; }
                }

                // 1. Tìm và click nút Danh Bạ
                var contactBtn = document.querySelector('[data-id="btn_Main_Tab_Contact"], [title*="Danh bạ"], [aria-label*="Danh bạ"], [title*="Contacts"], div[icon="outline-contact"]');
                if (!contactBtn) {
                    // Tìm bằng XPath chứa chữ "Danh bạ"
                    var snap = document.evaluate("//*[contains(normalize-space(text()), 'Danh bạ') or contains(normalize-space(text()), 'Contacts')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    for (var i = 0; i < snap.snapshotLength; i++) {
                        var el = snap.snapshotItem(i);
                        if (el && el.offsetParent !== null) { contactBtn = el; break; }
                    }
                }
                if (!contactBtn) {
                    var leftNav = document.querySelectorAll('.nav__tabs__top .nav__tabs__item, .left-menu-item, [class*="nav-item"]');
                    if (leftNav.length >= 2) contactBtn = leftNav[1];
                }

                if (contactBtn) {
                    robustClick(contactBtn);
                    await new Promise(function(r) { setTimeout(r, 700); });
                }

                // 2. Tìm và click "Danh sách nhóm"
                var groupTab = null;
                var groupSnap = document.evaluate("//*[contains(normalize-space(text()), 'Danh sách nhóm') or contains(normalize-space(text()), 'Group list')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                for (var j = 0; j < groupSnap.snapshotLength; j++) {
                    var gEl = groupSnap.snapshotItem(j);
                    if (gEl && gEl.offsetParent !== null) {
                        groupTab = gEl.closest('[class*="item"], [class*="tab"], [role="button"], li, div') || gEl;
                        break;
                    }
                }

                if (!groupTab) {
                    var subTabs = document.querySelectorAll('[data-id="sub_tab_group"], [data-id*="group"], .sub-tab-item, .contact-subtab-item, div[class*="sub-tab"]');
                    for (var t = 0; t < subTabs.length; t++) {
                        var tabText = (subTabs[t].innerText || '').toLowerCase();
                        if (tabText.indexOf('nhóm') !== -1 || subTabs[t].getAttribute('data-id') === 'sub_tab_group') {
                            groupTab = subTabs[t];
                            break;
                        }
                    }
                }

                if (groupTab) {
                    robustClick(groupTab);
                    await new Promise(function(r) { setTimeout(r, 800); });
                    return true;
                }
                return false;
            })();
        `);

        if (openedGroupDirectory) {
            appendScanModalLog('Đã vào Danh Sách Nhóm! Bắt đầu quét chuyên sâu...');
        } else {
            appendScanModalLog('Đang thử bóc tách trực tiếp giao diện Danh Bạ...');
        }

        // Cuộn danh bạ từng bước với bộ tìm container cuộn tự động (Dynamic Scroll Container)
        let lastZaloCount = Object.keys(foundZaloMap).length;
        let noChangeSteps = 0;

        for (let s = 1; s <= 25; s++) {
            if (stopScanRequested) break;

            const batch = await wv.executeJavaScript(`
                (function() {
                    var names = [];

                    // Tìm container cuộn chính xác của danh bạ nhóm
                    var allDivs = document.querySelectorAll('div, ul, main, section');
                    var scrollContainer = null;
                    for (var i = 0; i < allDivs.length; i++) {
                        var d = allDivs[i];
                        var style = window.getComputedStyle(d);
                        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && d.scrollHeight > d.clientHeight + 40) {
                            if (!scrollContainer || d.scrollHeight > scrollContainer.scrollHeight) {
                                scrollContainer = d;
                            }
                        }
                    }

                    // Thu thập toàn bộ các mục nhóm có trên màn hình
                    var groupRows = document.querySelectorAll('.group-item, [data-id*="group_item"], .contact-list-item, div[class*="group-row"], div[class*="contact-item"], div[class*="group-list"] > div');
                    if (groupRows.length === 0 && scrollContainer) {
                        groupRows = scrollContainer.querySelectorAll(':scope > div, :scope > ul > li, [role="listitem"]');
                    }

                    for (var k = 0; k < groupRows.length; k++) {
                        var row = groupRows[k];
                        var nameEl = row.querySelector('.group-item__name, .contact-item__name, [class*="name"], [class*="title"], h4, p, span');
                        var rawText = nameEl ? nameEl.innerText.trim() : row.innerText.trim();
                        if (rawText) {
                            var firstLine = rawText.split('\\n').map(function(l){ return l.trim(); }).filter(Boolean)[0] || '';
                            if (firstLine.length >= 2 && firstLine !== 'Zalo' && firstLine !== 'Cloud của tôi' && firstLine !== 'Truyền File' && firstLine !== 'Danh sách nhóm') {
                                names.push(firstLine);
                            }
                        }
                    }

                    // Cuộn container
                    if (scrollContainer) {
                        scrollContainer.scrollTop += 450;
                    } else {
                        window.scrollBy(0, 450);
                    }

                    return names;
                })();
            `);

            if (Array.isArray(batch)) {
                for (const name of batch) {
                    const key = name.toLowerCase().trim();
                    if (key.length >= 2 && !foundZaloMap[key]) {
                        foundZaloMap[key] = name.trim();
                    }
                }
            }

            const currentCount = Object.keys(foundZaloMap).length;
            const percent = 40 + Math.round((s / 25) * 35);
            updateScanModalStatus(`Đang cuộn danh bạ (Bước ${s}/25)...`, percent, currentCount);

            if (currentCount > lastZaloCount) {
                appendScanModalLog(`Bước ${s}: Đã phát hiện ${currentCount} nhóm (+${currentCount - lastZaloCount})`);
                lastZaloCount = currentCount;
                noChangeSteps = 0;
            } else {
                noChangeSteps++;
                if (noChangeSteps >= 5) {
                    appendScanModalLog(`Đã cuộn hết danh bạ nhóm Zalo sau ${s} bước.`);
                    break;
                }
            }

            await new Promise(r => setTimeout(r, 350));
        }

        // GIAI ĐOẠN 2: Trở về Tab Tin Nhắn & Quét Thêm Từ Danh Sách Hội Thoại
        updateScanModalStatus('Đang quét bổ sung từ danh sách hội thoại...', 75);
        appendScanModalLog('Đang chuyển về tab Tin Nhắn để gom các nhóm còn lại...');

        await wv.executeJavaScript(`
            (async function() {
                var msgBtn = document.querySelector('[data-id="btn_Main_Tab_Message"], [title*="Tin nhắn"], [aria-label*="Tin nhắn"], div[icon="outline-chat"]');
                if (!msgBtn) {
                    var snap = document.evaluate("//*[contains(normalize-space(text()), 'Tin nhắn')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    for (var i = 0; i < snap.snapshotLength; i++) {
                        var el = snap.snapshotItem(i);
                        if (el && el.offsetParent !== null) { msgBtn = el; break; }
                    }
                }
                if (!msgBtn) {
                    var leftNav = document.querySelectorAll('.nav__tabs__top .nav__tabs__item, .left-menu-item, [class*="nav-item"]');
                    if (leftNav.length >= 1) msgBtn = leftNav[0];
                }
                if (msgBtn) {
                    if (typeof msgBtn.click === 'function') msgBtn.click();
                    await new Promise(function(r) { setTimeout(r, 600); });
                }
            })();
        `);

        // Cuộn danh sách hội thoại 25 bước
        for (let cs = 1; cs <= 25; cs++) {
            if (stopScanRequested) break;

            const convBatch = await wv.executeJavaScript(`
                (function() {
                    var names = [];
                    var convContainer = document.querySelector('#conversationList, .conv-list, .virtualized-scroll, div[data-id="virtual-list"], div[class*="conv-list"]');
                    if (convContainer) {
                        var items = convContainer.querySelectorAll('.conv-item, [data-id*="conv_item"], div[id^="conv-item-"], .group-item, div[class*="chat-item"]');
                        for (var i = 0; i < items.length; i++) {
                            var el = items[i];
                            var titleEl = el.querySelector('.conv-item-title__more, .conv-item-title, .group-item__name, [class*="title__more"], [class*="conv-item-title"]');
                            var name = titleEl ? titleEl.innerText.trim() : '';
                            if (!name) continue;

                            var dataId = el.getAttribute('data-id') || el.id || '';
                            var hasGroupAvatar = el.querySelector('.avatar-group, .avatar--group, [class*="avatar-group"], [class*="group-avatar"]') !== null;
                            var imgCount = el.querySelectorAll('.avatar img, [class*="avatar"] img, img').length;
                            var hasGroupIcon = el.querySelector('i[class*="group"], [data-icon*="group"], [class*="group-icon"], svg[class*="group"]') !== null;
                            var isGroupDataId = dataId.indexOf('g') !== -1 || dataId.indexOf('group') !== -1;
                            var hasMemberText = (el.innerText || '').indexOf('thành viên') !== -1;

                            if (isGroupDataId || hasGroupAvatar || imgCount > 1 || hasGroupIcon || hasMemberText) {
                                names.push(name);
                            }
                        }
                        convContainer.scrollTop += 450;
                    }
                    return names;
                })();
            `);

            if (Array.isArray(convBatch)) {
                for (const name of convBatch) {
                    const key = name.toLowerCase().trim();
                    if (key.length >= 2 && !foundZaloMap[key]) {
                        foundZaloMap[key] = name.trim();
                    }
                }
            }

            const currentCount = Object.keys(foundZaloMap).length;
            updateScanModalStatus(`Đang cuộn hội thoại (Bước ${cs}/25)...`, 75 + Math.round((cs / 25) * 23), currentCount);
            await new Promise(r => setTimeout(r, 250));
        }

        const finalZaloGroups = Object.values(foundZaloMap);
        updateScanModalStatus('Đang lưu nhóm vào hệ thống...', 98, finalZaloGroups.length);

        if (finalZaloGroups.length > 0) {
            await window.electronApi.addZaloGroupsBulk(finalZaloGroups);
            if (window.electronApi.addLog) {
                await window.electronApi.addLog('info', `[Zalo Scanner] Quét hoàn tất: đã lưu ${finalZaloGroups.length} nhóm Zalo vào cơ sở dữ liệu.`);
            }
            appendScanModalLog(`🎉 Thành công: Đã tìm thấy và lưu ${finalZaloGroups.length} nhóm Zalo!`);
            updateScanModalStatus('Quét thành công!', 100, finalZaloGroups.length);
            showToast(`🎉 Đã quét thành công ${finalZaloGroups.length} nhóm Zalo!`, 'success');
            await loadZaloGroups();
            setTimeout(() => {
                closeScanModal();
                switchTab('zalo-groups');
            }, 1000);
        } else {
            updateScanModalStatus('Chưa phát hiện nhóm', 100, 0);
            appendScanModalLog('Chưa tìm thấy nhóm Zalo nào. Hãy đảm bảo tài khoản đã tham gia nhóm.');
            if (window.electronApi.addLog) {
                await window.electronApi.addLog('warn', '[Zalo Scanner] Không tìm thấy nhóm Zalo nào.');
            }
            showToast('Chưa phát hiện nhóm Zalo nào. Bạn có thể mở một nhóm Zalo trên màn hình rồi bấm "Theo dõi nhóm này".', 'info');
            setTimeout(closeScanModal, 2500);
        }

    } catch (e) {
        console.error('Lỗi triggerZaloGroupScan:', e);
        updateScanModalStatus('Lỗi khi quét nhóm Zalo', 100);
        appendScanModalLog('Lỗi: ' + e.message);
        if (window.electronApi.addLog) {
            await window.electronApi.addLog('error', `[Zalo Scanner] Lỗi: ${e.message}`);
        }
        showToast('Lỗi khi quét nhóm Zalo: ' + e.message, 'error');
        setTimeout(closeScanModal, 3000);
    }
}

// 2. TỰ ĐỘNG QUÉT TOÀN DIỆN DANH SÁCH NHÓM FACEBOOK ĐÃ THAM GIA
async function triggerFbGroupScan() {
    const wv = document.getElementById('fb-wv');
    if (!wv) return;

    showScanModal('Facebook', 'Đang Quét Nhóm Facebook Đã Tham Gia...');
    appendScanModalLog('Kiểm tra phiên đăng nhập Facebook...');

    try {
        const currentUrl = wv.getURL();
        if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('facebook.com')) {
            updateScanModalStatus('Đang mở Facebook...', 20);
            appendScanModalLog('Đang tải trang https://www.facebook.com/groups/joins/...');
            wv.loadURL('https://www.facebook.com/groups/joins/');
            showToast('Đang mở Facebook... Vui lòng đăng nhập tài khoản trước khi quét!', 'info');
            switchTab('fb');
            closeScanModal();
            return;
        }

        const isLoginPage = await wv.executeJavaScript(`
            Boolean(document.querySelector('input[type="password"], input[name="pass"], #loginbutton, [data-testid="royal_login_button"]'))
        `);
        if (isLoginPage) {
            updateScanModalStatus('⚠️ Chưa đăng nhập Facebook!', 100);
            appendScanModalLog('Lỗi: Bạn chưa đăng nhập Facebook.');
            if (window.electronApi.addLog) {
                await window.electronApi.addLog('warn', '[Facebook Scanner] Facebook chưa đăng nhập tài khoản.');
            }
            showToast('⚠️ Bạn chưa đăng nhập Facebook! Hãy đăng nhập trên màn hình trước khi quét.', 'error');
            switchTab('fb');
            setTimeout(closeScanModal, 2000);
            return;
        }

        if (!currentUrl.includes('/groups/joins')) {
            updateScanModalStatus('Đang chuyển đến trang Nhóm Đã Tham Gia...', 30);
            appendScanModalLog('Đang điều hướng đến https://www.facebook.com/groups/joins/...');
            wv.loadURL('https://www.facebook.com/groups/joins/');
            await new Promise(r => setTimeout(r, 2500));
        }

        await executeScanOnFbWebview(wv);

    } catch (e) {
        console.error('Lỗi triggerFbGroupScan:', e);
        updateScanModalStatus('Lỗi khi quét: ' + e.message, 100);
        appendScanModalLog('Lỗi: ' + e.message);
        if (window.electronApi.addLog) {
            await window.electronApi.addLog('error', `[Facebook Scanner] Lỗi: ${e.message}`);
        }
        showToast('Lỗi: ' + e.message, 'error');
        setTimeout(closeScanModal, 3000);
    }
}

async function executeScanOnFbWebview(wv) {
    updateScanModalStatus('Đang tự động cuộn trang và thu thập danh sách nhóm Facebook...', 35);
    appendScanModalLog('Bắt đầu chu trình cuộn trang liên tục (Deep Progressive Auto-Scroll)...');
    if (window.electronApi.addLog) {
        await window.electronApi.addLog('info', '[Facebook Scanner] Đang cuộn trang bóc tách nhóm Facebook đã tham gia...');
    }

    try {
        const harvestedMap = {};
        let consecutiveNoChange = 0;
        const maxSteps = 30;

        for (let step = 1; step <= maxSteps; step++) {
            if (stopScanRequested) break;

            const stepResult = await wv.executeJavaScript(`
                (function() {
                    var excludedIds = [
                        'feed', 'discover', 'notifications', 'joins', 'create', 'search',
                        'your_groups', 'membership_questions', 'manage', 'chats', 'member',
                        'members', 'buy_sell_discussion', 'permalink', 'user', 'about',
                        'events', 'media', 'files', 'tagged', 'post', 'posts'
                    ];

                    var found = [];
                    var links = document.querySelectorAll('a[href*="/groups/"]');
                    for (var i = 0; i < links.length; i++) {
                        var a = links[i];
                        var href = a.getAttribute('href') || '';
                        var match = href.match(/\\/groups\\/([^/?#]+)/);
                        if (!match) continue;
                        var groupId = match[1];
                        if (excludedIds.indexOf(groupId) !== -1) continue;

                        var fullUrl = 'https://www.facebook.com/groups/' + groupId + '/';
                        var rawText = (a.innerText || a.getAttribute('aria-label') || '').trim();
                        var lines = rawText.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
                        var name = lines[0] || '';
                        if (!name || name.indexOf('Xem tất cả') !== -1 || name.indexOf('Tạo nhóm') !== -1 || name.indexOf('http') === 0 || name.length < 2) {
                            name = 'Nhóm FB (' + groupId + ')';
                        }

                        var memberCount = '';
                        for (var j = 0; j < lines.length; j++) {
                            var l = lines[j];
                            if (l.indexOf('thành viên') !== -1 || l.toLowerCase().indexOf('member') !== -1 || l.indexOf('bài viết') !== -1) {
                                memberCount = l;
                                break;
                            }
                        }

                        found.push({ groupId: groupId, name: name, url: fullUrl, memberCount: memberCount });
                    }

                    // Cuộn cả window, html và các scrollable containers trong Facebook DOM
                    window.scrollBy(0, 1200);
                    if (document.documentElement) document.documentElement.scrollTop += 1200;
                    document.querySelectorAll('div[role="feed"], div[role="main"], div[data-pagelet*="Group"], div[aria-label*="nhóm"]').forEach(function(el) {
                        el.scrollTop += 1200;
                    });

                    return found;
                })();
            `);

            let newFoundInThisStep = 0;
            if (Array.isArray(stepResult)) {
                for (const g of stepResult) {
                    if (!harvestedMap[g.url] || (harvestedMap[g.url].name.startsWith('Nhóm FB (') && !g.name.startsWith('Nhóm FB ('))) {
                        if (!harvestedMap[g.url]) newFoundInThisStep++;
                        harvestedMap[g.url] = g;
                    }
                }
            }

            const totalHarvested = Object.keys(harvestedMap).length;
            const percent = Math.min(95, 35 + Math.round((step / maxSteps) * 60));
            updateScanModalStatus(`Đang cuộn trang (Bước ${step}/${maxSteps})...`, percent, totalHarvested);
            appendScanModalLog(`Bước ${step}: Thu thập được ${totalHarvested} nhóm (+${newFoundInThisStep} nhóm mới)`);

            if (newFoundInThisStep === 0) {
                consecutiveNoChange++;
                if (consecutiveNoChange >= 4) {
                    appendScanModalLog(`Đã cuộn đến đáy danh sách nhóm sau ${step} bước.`);
                    break;
                }
            } else {
                consecutiveNoChange = 0;
            }

            // Chờ 800ms để Facebook lazy-load thêm dữ liệu
            await new Promise(r => setTimeout(r, 800));
        }

        const finalGroups = Object.values(harvestedMap);
        updateScanModalStatus('Đang lưu nhóm vào hệ thống...', 98, finalGroups.length);

        if (finalGroups.length > 0) {
            await window.electronApi.forwardFbGroups(finalGroups);
            if (window.electronApi.addLog) {
                await window.electronApi.addLog('info', `[Facebook Scanner] Quét hoàn tất: đã lưu ${finalGroups.length} nhóm Facebook vào cơ sở dữ liệu.`);
            }
            appendScanModalLog(`🎉 Hoàn tất: Đã lưu thành công ${finalGroups.length} nhóm Facebook!`);
            updateScanModalStatus('Quét hoàn tất!', 100, finalGroups.length);
            showToast(`🎉 Đã quét thành công ${finalGroups.length} nhóm Facebook!`, 'success');
            await loadFbGroups();
            setTimeout(() => {
                closeScanModal();
                switchTab('groups');
            }, 1000);
        } else {
            updateScanModalStatus('Chưa phát hiện nhóm', 100, 0);
            appendScanModalLog('Chưa tìm thấy nhóm nào. Hãy chắc chắn bạn đã vào mục Nhóm Đã Tham Gia.');
            if (window.electronApi.addLog) {
                await window.electronApi.addLog('warn', '[Facebook Scanner] Không tìm thấy nhóm Facebook nào trên trang.');
            }
            showToast('Chưa thấy nhóm nào trên trang này. Hãy vào mục "Nhóm bạn đã tham gia" trên Facebook rồi bấm Quét lại.', 'info');
            setTimeout(closeScanModal, 2500);
        }

    } catch (err) {
        console.error('Lỗi executeScanOnFbWebview:', err);
        updateScanModalStatus('Lỗi khi quét: ' + err.message, 100);
        appendScanModalLog('Lỗi: ' + err.message);
        if (window.electronApi.addLog) {
            await window.electronApi.addLog('error', `[Facebook Scanner] Lỗi: ${err.message}`);
        }
        showToast('Lỗi khi quét: ' + err.message, 'error');
        setTimeout(closeScanModal, 3000);
    }
}

function navFbHome() {
    const wv = document.getElementById('fb-wv');
    if (wv) wv.loadURL('https://www.facebook.com');
}

function reloadFbWebview() {
    const wv = document.getElementById('fb-wv');
    if (wv) wv.reload();
}

// 5. Quản Lý Nhóm Facebook (Groups)
async function loadFbGroups() {
    try {
        const res = await window.electronApi.getFbGroups();
        if (res.success) {
            state.fbGroups = res.groups;
            renderFbGroupsTable();
        }
    } catch (e) {
        console.error('Error loadFbGroups:', e);
    }
}

function renderFbGroupsTable(filterText = '') {
    const tbody = document.getElementById('fb-groups-table-body');
    let list = state.fbGroups;
    if (filterText) {
        list = list.filter(g => g.name.toLowerCase().includes(filterText.toLowerCase()));
    }

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="p-8 text-center text-slate-500 text-xs">
                    <div class="mb-3">Chưa có nhóm Facebook nào trong danh sách.</div>
                    <button onclick="triggerFbGroupScan()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-2 shadow-sm transition-all">
                        <i data-lucide="scan" class="w-4 h-4"></i> Bấm Vào Đây Để Quét Nhóm Facebook Ngay
                    </button>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }

    tbody.innerHTML = list.map(g => `
        <tr class="hover:bg-slate-900/50 transition-colors">
            <td class="p-3.5 text-center">
                <input type="checkbox" ${g.is_active ? 'checked' : ''} onchange="toggleFbGroupStatus(${g.id})" class="w-4 h-4 rounded text-blue-600 bg-slate-800 border-slate-700 cursor-pointer">
            </td>
            <td class="p-3.5 font-bold text-white">
                ${escapeHtml(g.name)}
            </td>
            <td class="p-3.5 font-mono text-[11px] text-slate-400">
                <a href="#" onclick="openFbUrl('${escapeHtml(g.url)}')" class="hover:text-blue-400 hover:underline truncate max-w-xs block">${escapeHtml(g.url)}</a>
            </td>
            <td class="p-3.5 text-right">
                <button onclick="deleteFbGroupRow(${g.id})" class="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors" title="Xóa nhóm">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </td>
        </tr>
    `).join('');
    lucide.createIcons();
}

function filterFbGroupsTable() {
    const query = document.getElementById('fb-group-search')?.value || '';
    renderFbGroupsTable(query);
}

async function toggleFbGroupStatus(id) {
    await window.electronApi.toggleFbGroup(id);
    loadFbGroups();
}

async function toggleAllFbGroupsUI(isActive) {
    try {
        await window.electronApi.toggleAllFbGroups(isActive);
        showToast(isActive ? 'Đã bật đăng bài cho tất cả nhóm FB!' : 'Đã tắt đăng bài tất cả nhóm FB.', 'info');
        loadFbGroups();
    } catch (e) {
        showToast('Lỗi khi đổi trạng thái nhóm FB: ' + e.message, 'error');
    }
}

async function deleteFbGroupRow(id) {
    try {
        await window.electronApi.deleteFbGroup(id);
        loadFbGroups();
    } catch (e) {
        console.error('Error deleteFbGroupRow:', e);
    }
}

function openFbUrl(url) {
    const wv = document.getElementById('fb-wv');
    if (wv && url) {
        switchTab('fb');
        wv.loadURL(url);
    }
}

async function openAddFbGroupModal() {
    const name = prompt('Nhập tên nhóm Facebook:');
    if (!name?.trim()) return;
    const url = prompt('Nhập link nhóm Facebook (https://facebook.com/groups/...):');
    if (!url?.trim()) return;

    const res = await window.electronApi.addFbGroup(name.trim(), url.trim());
    if (res.success) {
        showToast('Đã thêm nhóm Facebook!', 'success');
        loadFbGroups();
    } else {
        showToast(res.error, 'error');
    }
}

// 6. Cấu hình AI Gemini
async function loadAiSettings() {
    try {
        const res = await window.electronApi.getSettings();
        if (res.success) {
            state.settings = res.settings;
            // Cấu hình Cuộc trò chuyện đã ghim & Gửi nội dung thô cho Chrome Gemini Web
            const urlInput = document.getElementById('cfg-gemini-conversation-url');
            if (urlInput) urlInput.value = res.settings.gemini_conversation_url || '';
            const rawCheck = document.getElementById('cfg-gemini-send-raw-content');
            if (rawCheck) rawCheck.checked = (res.settings.gemini_send_raw_content !== '0');
        }
    } catch (e) {
        console.error('Error loadAiSettings:', e);
    }
}

// 7. Cài đặt hệ thống
async function loadGeneralSettings() {
    try {
        const res = await window.electronApi.getSettings();
        if (res.success) {
            document.getElementById('cfg-auto-post').value = res.settings.auto_post_enabled || '0';
            document.getElementById('cfg-emergency-stop').value = res.settings.emergency_stop || '0';
            document.getElementById('cfg-delay-min').value = res.settings.delay_min_seconds || '180';
            document.getElementById('cfg-delay-max').value = res.settings.delay_max_seconds || '480';
            const smartSched = document.getElementById('cfg-smart-scheduler');
            if (smartSched) smartSched.value = res.settings.smart_scheduler_enabled || '0';
        }
    } catch (e) {
        console.error('Error loadGeneralSettings:', e);
    }
}

async function saveAllSettings() {
    const auto = document.getElementById('cfg-auto-post').value;
    const stop = document.getElementById('cfg-emergency-stop').value;
    const min = document.getElementById('cfg-delay-min').value;
    const max = document.getElementById('cfg-delay-max').value;
    const smartSched = document.getElementById('cfg-smart-scheduler')?.value || '0';

    await window.electronApi.saveSettings({
        auto_post_enabled: auto,
        emergency_stop: stop,
        delay_min_seconds: min,
        delay_max_seconds: max,
        smart_scheduler_enabled: smartSched
    });
    showToast('Đã lưu cấu hình cài đặt hệ thống!', 'success');
    loadStatus();
}

// Sao Lưu & Phục Hồi Dữ Liệu
async function exportDataBackup() {
    try {
        const res = await window.electronApi.exportBackup();
        if (res.success) {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(res.data, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            const dateStr = new Date().toISOString().slice(0, 10);
            downloadAnchor.setAttribute("download", `posthub_backup_${dateStr}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            showToast('Đã xuất file sao lưu thành công!', 'success');
        } else {
            showToast('Lỗi xuất sao lưu: ' + res.error, 'error');
        }
    } catch (e) {
        console.error('Error exportBackup:', e);
        showToast('Lỗi xuất sao lưu: ' + e.message, 'error');
    }
}

function triggerImportBackup() {
    const fileInput = document.getElementById('import-backup-file');
    if (fileInput) fileInput.click();
}

async function handleBackupFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const json = JSON.parse(e.target.result);
            if (!confirm(`Bạn có chắc muốn phục hồi dữ liệu từ file "${file.name}"? Dữ liệu hiện tại sẽ được cập nhật.`)) {
                event.target.value = '';
                return;
            }
            const res = await window.electronApi.importBackup(json);
            if (res.success) {
                showToast(`Phục hồi thành công: ${res.stats.importedSettings} cài đặt, ${res.stats.importedFbGroups} nhóm FB, ${res.stats.importedZaloGroups} nhóm Zalo!`, 'success');
                await loadInitialData();
            } else {
                showToast('Lỗi phục hồi: ' + res.error, 'error');
            }
        } catch (err) {
            showToast('Định dạng file JSON không hợp lệ: ' + err.message, 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}

// 8. Modal Biên Tập & Đăng Bài
function openEditModal(postId) {
    const post = state.posts.find(p => p.id === postId);
    if (!post) return;
    document.getElementById('modal-post-id').value = post.id;
    document.getElementById('modal-orig-text').innerText = post.original_text || '(Không có nội dung gốc)';
    document.getElementById('modal-rewritten-input').value = post.rewritten_text || post.original_text || '';
    document.getElementById('post-modal').classList.remove('hidden');
}

function closePostModal() {
    document.getElementById('post-modal').classList.add('hidden');
}

async function saveModalEdit() {
    const id = document.getElementById('modal-post-id').value;
    const text = document.getElementById('modal-rewritten-input').value;
    await window.electronApi.updatePost(id, text, 'pending');
    closePostModal();
    showToast('Đã lưu nội dung bài viết!', 'success');
    loadPosts();
}

async function publishDirectFromModal() {
    const id = document.getElementById('modal-post-id').value;
    const text = document.getElementById('modal-rewritten-input').value;
    await window.electronApi.updatePost(id, text, 'approved');
    closePostModal();
    showToast('Đang tiến hành xuất bản bài viết...', 'info');
    const res = await window.electronApi.publishPost(id);
    if (res.success) {
        showToast('Đã đăng bài lên Facebook thành công!', 'success');
        loadPosts();
        loadStatus();
    } else {
        showToast(res.error, 'error');
    }
}

async function publishPostDirect(id) {
    showToast('Đang tiến hành xuất bản bài viết...', 'info');
    const res = await window.electronApi.publishPost(id);
    if (res.success) {
        showToast('Đã đăng bài lên Facebook thành công!', 'success');
        loadPosts();
        loadStatus();
    } else {
        showToast(res.error, 'error');
    }
}

async function deletePostFromModal() {
    const id = document.getElementById('modal-post-id').value;
    await window.electronApi.deletePost(id);
    closePostModal();
    showToast(`Đã xóa bài viết #${id} khỏi hàng đợi.`, 'info');
    loadPosts();
    loadStatus();
}

// 9. Nhật ký (Logs)
async function loadLogs() {
    try {
        const res = await window.electronApi.getLogs();
        if (res.success) {
            const container = document.getElementById('logs-container');
            if (res.logs.length === 0) {
                container.innerHTML = `<div class="text-slate-600">Chưa có nhật ký hoạt động.</div>`;
                return;
            }
            container.innerHTML = res.logs.map(l => formatLogHtml(l)).join('');
        }
    } catch (e) {
        console.error('Error loadLogs:', e);
    }
}

function appendLogEntry(log) {
    const container = document.getElementById('logs-container');
    const empty = container.querySelector('.text-slate-600');
    if (empty) container.innerHTML = '';

    const div = document.createElement('div');
    div.innerHTML = formatLogHtml(log);
    container.prepend(div.firstElementChild);
}

function refreshLogs() {
    loadLogs();
    showToast('Đã làm mới nhật ký!', 'info');
}

function formatLogHtml(l) {
    const time = formatDate(l.created_at);
    const color = l.level === 'error' ? 'text-rose-400 font-bold' : (l.level === 'warn' ? 'text-amber-400' : 'text-emerald-400');
    return `
        <div class="leading-relaxed border-b border-slate-900 pb-1 flex items-start gap-2">
            <span class="text-slate-600 shrink-0">[${time}]</span>
            <span class="${color} shrink-0">[${l.level.toUpperCase()}]</span>
            <span class="text-slate-300 break-words">${escapeHtml(l.message)}</span>
        </div>
    `;
}

// Helpers
function getStatusLabel(status) {
    const map = {
        pending: 'Chờ duyệt',
        approved: 'Đã duyệt (Chờ đăng)',
        posted: 'Đã đăng xong',
        failed: 'Lỗi đăng'
    };
    return map[status] || status;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return isNaN(d) ? dateStr : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-emerald-600 text-white',
        error: 'bg-rose-600 text-white',
        info: 'bg-blue-600 text-white'
    };
    toast.className = `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 ${colors[type] || colors.info} transition-all duration-300 transform translate-y-3 opacity-0`;
    toast.innerText = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-3', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('translate-y-3', 'opacity-0');
        setTimeout(() => toast.remove(), 3500);
    }, 3500);
}

// ==========================================
// QUÉT LỊCH SỬ TIN NHẮN ZALO & ĐĂNG DẦN
// ==========================================
function openZaloHistoryModal() {
    const modal = document.getElementById('zalo-history-modal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const progressArea = document.getElementById('history-scan-progress-area');
    if (progressArea) progressArea.classList.add('hidden');

    const btn = document.getElementById('btn-start-history-scan');
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Bắt Đầu Quét & Nạp`;
    }

    if (window.lucide) lucide.createIcons();
}

function closeZaloHistoryModal() {
    const modal = document.getElementById('zalo-history-modal');
    if (modal) modal.classList.add('hidden');
}

async function startZaloHistoryScanAction() {
    const wv = document.getElementById('zalo-wv');
    if (!wv) {
        showToast('Không tìm thấy trình duyệt Zalo Web!', 'error');
        return;
    }

    const days = parseInt(document.getElementById('history-scan-days')?.value || '7', 10);
    const scope = document.getElementById('history-scan-scope')?.value || 'monitored';
    const limit = parseInt(document.getElementById('history-scan-limit')?.value || '50', 10);

    const btn = document.getElementById('btn-start-history-scan');
    const progressArea = document.getElementById('history-scan-progress-area');
    const statusText = document.getElementById('history-scan-status-text');
    const counterText = document.getElementById('history-scan-counter');
    const progressBar = document.getElementById('history-scan-progress-bar');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Đang Quét...`;
        if (window.lucide) lucide.createIcons();
    }

    if (progressArea) progressArea.classList.remove('hidden');
    if (statusText) statusText.innerText = `Đang chuẩn bị quét lịch sử tin nhắn trong ${days} ngày qua...`;
    if (counterText) counterText.innerText = 'Bắt đầu...';
    if (progressBar) progressBar.style.width = '15%';

    try {
        // Đảm bảo tab Zalo Web đang hiển thị để Chromium render DOM đầy đủ
        if (state.currentTab !== 'zalo') {
            switchTab('zalo');
            await new Promise(r => setTimeout(r, 400));
        }

        let currentUrl = '';
        try {
            currentUrl = wv.getURL ? wv.getURL() : '';
        } catch (e) {}

        if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('zalo.me')) {
            showToast('Vui lòng đăng nhập Zalo Web trước khi quét lịch sử!', 'error');
            if (statusText) statusText.innerText = '⚠️ Bạn chưa mở hoặc chưa đăng nhập Zalo Web';
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Thử Lại`;
                if (window.lucide) lucide.createIcons();
            }
            return;
        }

        if (statusText) statusText.innerText = `Đang quét lịch sử hội thoại và cuộn tải tin cũ (${days} ngày)...`;
        if (progressBar) progressBar.style.width = '35%';

        // Chạy script trích xuất tin nhắn trực tiếp từ Webview Zalo
        const extractedMessages = await wv.executeJavaScript(`
            (async function(daysToScan, scopeMode) {
                const results = [];
                const seenKeys = new Set();

                function addRecord(groupName, sender, text, images) {
                    if (!text || typeof text !== 'string') return;
                    const clean = text.trim();
                    if (clean.length < 15 && (!images || images.length === 0)) return;
                    const key = (groupName || '') + '::' + clean.substring(0, 70);
                    if (seenKeys.has(key)) return;
                    seenKeys.add(key);
                    results.push({
                        groupName: (groupName || '').trim(),
                        sender: (sender || 'Thành viên').trim(),
                        text: clean,
                        images: images || [],
                        timestamp: Date.now()
                    });
                }

                function getActiveTitle() {
                    var selectors = [
                        '#header-title',
                        '.header-title',
                        '.chat-title',
                        '[data-id="chat-title"]',
                        '.conv-item.active .conv-item-title__more',
                        '.conv-item.selected .conv-item-title__more',
                        '.chat-info__general__title',
                        'div[class*="header"] span[class*="title"]',
                        'div[class*="header"] h4'
                    ];
                    for (var i = 0; i < selectors.length; i++) {
                        var el = document.querySelector(selectors[i]);
                        if (el && el.innerText && el.innerText.trim()) {
                            return el.innerText.trim().split('\\n')[0].trim();
                        }
                    }
                    return '';
                }

                // Tìm khung cuộn tin nhắn ở panel bên phải
                function findChatScrollElement() {
                    var preferred = document.querySelector('.chat-message-list, #messageView, .message-view__body, [data-id="chat-message-list"], .chat-date');
                    if (preferred) return preferred;

                    var allDivs = document.querySelectorAll('div, main');
                    for (var i = 0; i < allDivs.length; i++) {
                        var d = allDivs[i];
                        var s = window.getComputedStyle(d);
                        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && d.clientHeight > 180) {
                            var r = d.getBoundingClientRect();
                            if (r.left >= 200 && r.width >= 250) {
                                return d;
                            }
                        }
                    }
                    return null;
                }

                // Trích xuất toàn bộ ảnh đính kèm (img tag, data-src, background-image)
                function extractImagesFromEl(el) {
                    var imgs = [];
                    if (!el) return imgs;

                    // 1. Quét thẻ <img>
                    el.querySelectorAll('img').forEach(function(img) {
                        var src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-orig-src') || img.src;
                        if (!src) return;
                        var lower = src.toLowerCase();
                        if (lower.includes('avatar') || lower.includes('emoji') || lower.includes('icon') || lower.includes('sticker') || lower.startsWith('data:image/svg')) {
                            return;
                        }
                        if (img.classList.contains('avatar') || img.closest('.avatar, .sender-avatar, [class*="avatar"]')) {
                            return;
                        }
                        if (!imgs.includes(src)) imgs.push(src);
                    });

                    // 2. Quét background-image (cho các ô lưới ảnh của Zalo)
                    el.querySelectorAll('div[style*="background"], a[style*="background"], span[style*="background"]').forEach(function(bEl) {
                        var bg = bEl.style.backgroundImage || window.getComputedStyle(bEl).backgroundImage || '';
                        var match = bg.match(/url\(["']?(https?:\/\/[^"']+|blob:[^"']+)["']?\)/i);
                        if (match && match[1]) {
                            var url = match[1];
                            var lower = url.toLowerCase();
                            if (!lower.includes('avatar') && !lower.includes('emoji') && !lower.includes('icon') && !lower.includes('sticker') && !imgs.includes(url)) {
                                imgs.push(url);
                            }
                        }
                    });

                    return imgs;
                }

                // Bóc tách tin nhắn trong chat view hiện tại và gom ảnh liền kề của cùng 1 người đăng
                function harvestCurrentChat(currentGroupName) {
                    var msgBoxes = Array.from(document.querySelectorAll(
                        '[id*="msg"], [data-id*="msg"], .chat-item, .msg-item, .chat-message, div[class*="chat-message"], div[class*="message-view"], div[class*="bubble"], div[class*="msg-"]'
                    ));

                    var chatScroll = findChatScrollElement();
                    if (msgBoxes.length === 0 && chatScroll) {
                        var divs = Array.from(chatScroll.querySelectorAll('div'));
                        msgBoxes = divs.filter(function(d) {
                            var t = (d.innerText || '').trim();
                            return (t.length >= 15 || d.querySelector('img')) && d.children.length <= 6;
                        });
                    }

                    // Bước 1: Trích xuất thô từng bong bóng chat
                    var rawItems = [];
                    var lastKnownSender = 'Thành viên';

                    msgBoxes.forEach(function(el) {
                        var senderEl = el.querySelector('.sender-name, [class*="sender"], [class*="author"], [class*="name"]');
                        var sender = senderEl ? senderEl.innerText.trim() : lastKnownSender;
                        if (sender && sender !== 'Thành viên') {
                            lastKnownSender = sender;
                        }

                        var textEl = el.querySelector('.content-text, .msg-text, [class*="content-text"], [class*="text-msg"], [class*="text-message"], [class*="message-content"], [class*="bubble-content"], p, pre');
                        var text = '';
                        if (textEl && textEl.innerText && textEl.innerText.trim().length >= 10) {
                            text = textEl.innerText.trim();
                        } else {
                            text = (el.innerText || '').trim();
                        }

                        if (/^(đã đổi ảnh|đã tham gia|đã rời khỏi|đã gửi một nhãn dán|đã ghim)/i.test(text)) {
                            return;
                        }

                        var images = extractImagesFromEl(el);

                        rawItems.push({
                            sender: sender || 'Thành viên',
                            text: text,
                            images: images
                        });
                    });

                    // Bước 2: Gom cụm tin nhắn cùng người gửi liền kề (Clustering)
                    // Bài viết và ảnh thường được người đăng gửi liên tiếp 2-4 tin kế nhau
                    for (var i = 0; i < rawItems.length; i++) {
                        var cur = rawItems[i];
                        if (!cur.text || cur.text.length < 15) continue;

                        var mergedImages = cur.images.slice();

                        // Quét các bong bóng ảnh lân cận trước/sau từ cùng một người đăng
                        for (var j = Math.max(0, i - 2); j <= Math.min(rawItems.length - 1, i + 5); j++) {
                            if (j === i) continue;
                            var other = rawItems[j];
                            if (other.sender === cur.sender && other.images.length > 0) {
                                other.images.forEach(function(imgSrc) {
                                    if (!mergedImages.includes(imgSrc)) {
                                        mergedImages.push(imgSrc);
                                    }
                                });
                            }
                        }

                        addRecord(currentGroupName, cur.sender, cur.text, mergedImages);
                    }
                }

                // HÀM QUÉT LỊCH SỬ CHAT CỦA MỘT HỘI THOẠI
                async function scanActiveConversationHistory(gName) {
                    harvestCurrentChat(gName);

                    var chatScroll = findChatScrollElement();
                    if (chatScroll) {
                        // Cuộn lên 6 nhịp để Zalo nạp tin nhắn cũ trong 1 tuần
                        var scrollSteps = Math.min(daysToScan * 2, 8);
                        for (var s = 0; s < scrollSteps; s++) {
                            chatScroll.scrollTop = 0;
                            chatScroll.dispatchEvent(new Event('scroll', { bubbles: true }));
                            await new Promise(function(r) { setTimeout(r, 450); });
                            harvestCurrentChat(gName);
                        }
                    }
                }

                // 1. Quét ngay hội thoại hiện tại
                var activeName = getActiveTitle() || 'Nhóm Zalo Đang Mở';
                await scanActiveConversationHistory(activeName);

                // 2. Nếu chọn quét 'monitored' hoặc 'all': tự động duyệt qua các nhóm trong danh sách hội thoại bên trái
                if (scopeMode !== 'active') {
                    var convRows = Array.from(document.querySelectorAll(
                        '.conv-item, [data-id*="conv"], [data-id*="thread"], div[class*="chat-item"], div[class*="conv-item"], div[class*="rel-item"], [role="listitem"]'
                    ));

                    // Duyệt tối đa 12 hội thoại trong danh sách để thu thập lịch sử
                    var maxConvs = Math.min(convRows.length, 12);
                    for (var c = 0; c < maxConvs; c++) {
                        var row = convRows[c];
                        var titleEl = row.querySelector('.conv-item-title__more, [class*="conv-item-title"], [class*="title"], [class*="name"], h4, h5');
                        var rName = titleEl ? titleEl.innerText.trim().split('\\n')[0].trim() : '';

                        if (rName && rName !== activeName) {
                            try {
                                row.click();
                                await new Promise(function(r) { setTimeout(r, 700); });
                                var newActiveName = getActiveTitle() || rName;
                                await scanActiveConversationHistory(newActiveName);
                            } catch (clickErr) {}
                        }
                    }
                }

                return results;
            })(${days}, "${scope}");
        `);

        const messagesCount = Array.isArray(extractedMessages) ? extractedMessages.length : 0;
        if (statusText) statusText.innerText = `Thu thập được ${messagesCount} tin. Đang lọc bài chất lượng & gửi AI...`;
        if (counterText) counterText.innerText = `${messagesCount} tin`;
        if (progressBar) progressBar.style.width = '65%';

        if (messagesCount === 0) {
            showToast('Không tìm thấy tin nhắn nào trong hội thoại Zalo hiện tại!', 'info');
            if (statusText) statusText.innerText = 'Không phát hiện tin nhắn nào trong cửa sổ chat Zalo.';
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Thử Lại`;
                if (window.lucide) lucide.createIcons();
            }
            return;
        }

        // Gửi sang Main process để lọc chất lượng, khử trùng lặp, gọi Gemini AI và nạp vào hàng đợi
        const result = await window.electronApi.processZaloHistory({
            messages: extractedMessages,
            options: {
                limit: limit,
                activeGroupName: state.activeZaloGroup,
                ignoreGroupFilter: scope === 'all' || scope === 'active'
            }
        });

        if (progressBar) progressBar.style.width = '100%';
        if (statusText) statusText.innerText = `Hoàn tất! Đã nạp ${result.queued || 0} bài vào hàng đợi để đăng dần (Bỏ qua: ${result.skipped || 0}).`;
        if (counterText) counterText.innerText = `${result.queued || 0} bài mới`;

        showToast(`Quét lịch sử hoàn tất: Đã nạp thành công ${result.queued || 0} bài vào hàng đợi!`, 'success');

        // Làm mới danh sách bài viết & thống kê
        loadPosts();
        loadStatus();

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5"></i> Đã Xong!`;
            if (window.lucide) lucide.createIcons();
        }

        setTimeout(() => {
            closeZaloHistoryModal();
        }, 1500);

    } catch (err) {
        console.error('Lỗi quét lịch sử Zalo:', err);
        showToast('Lỗi trong quá trình quét lịch sử: ' + err.message, 'error');
        if (statusText) statusText.innerText = 'Lỗi: ' + err.message;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Thử Lại`;
            if (window.lucide) lucide.createIcons();
        }
    }
}

// ==========================================
// 8. NGUỒN TIN DISCORD BOT & DUYỆT TƯƠNG TÁC
// ==========================================

function updateDebounceLabelUI(val) {
    const label = document.getElementById('discord-debounce-label');
    if (label) {
        label.innerText = `${val} giây (${val >= 60 ? (val / 60).toFixed(1) + ' phút' : ''})`;
    }
}

function toggleTokenVisibilityUI() {
    const input = document.getElementById('discord-bot-token');
    const icon = document.getElementById('token-eye-icon');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
        input.type = 'password';
        if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    if (window.lucide) lucide.createIcons();
}

function updateDiscordStatusUI(statusData) {
    const badge = document.getElementById('discord-status-badge');
    const toggleBtn = document.getElementById('discord-toggle-btn');
    const dot = document.getElementById('badge-discord-dot');
    const botNameDisp = document.getElementById('discord-bot-name-disp');
    const chDisp = document.getElementById('discord-channel-disp');

    const isConnected = (statusData?.status === 'connected' || statusData?.isConnected);

    if (badge) {
        if (isConnected) {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
            badge.innerText = '● Đang lắng nghe kênh';
        } else {
            badge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold bg-slate-800 text-slate-400 border border-slate-700';
            badge.innerText = 'Chưa kết nối';
        }
    }

    if (toggleBtn) {
        if (isConnected) {
            toggleBtn.className = 'bg-rose-600 hover:bg-rose-500 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 shadow-lg shadow-rose-900/30 transition-all';
            toggleBtn.innerHTML = '<i data-lucide="square" class="w-4 h-4"></i> Dừng Bot Discord';
        } else {
            toggleBtn.className = 'bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 shadow-lg shadow-violet-900/30 transition-all';
            toggleBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4"></i> Khởi Động Bot Discord';
        }
    }

    if (dot) {
        dot.className = isConnected ? 'ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse' : 'ml-auto w-2 h-2 rounded-full bg-slate-600';
    }

    if (botNameDisp) {
        botNameDisp.innerText = statusData?.botName || statusData?.botUser || (isConnected ? 'Đã kết nối' : 'Chưa kết nối');
    }

    if (chDisp) {
        chDisp.innerText = statusData?.channelId ? `ID: ${statusData.channelId}` : 'Chưa chọn';
    }

    if (window.lucide) lucide.createIcons();
}

async function loadDiscordSettingsUI() {
    try {
        const [settingsRes, statusRes] = await Promise.all([
            window.electronApi.getSettings(),
            window.electronApi.getDiscordStatus()
        ]);

        if (settingsRes?.success) {
            const s = settingsRes.settings;
            const tokenInput = document.getElementById('discord-bot-token');
            const chInput = document.getElementById('discord-channel-id');
            const debRange = document.getElementById('discord-debounce-range');

            if (tokenInput && s.discord_bot_token) tokenInput.value = s.discord_bot_token;
            if (chInput && s.discord_channel_id) chInput.value = s.discord_channel_id;
            if (debRange && s.discord_debounce_seconds) {
                debRange.value = s.discord_debounce_seconds;
                updateDebounceLabelUI(s.discord_debounce_seconds);
            }
        }

        if (statusRes?.success) {
            updateDiscordStatusUI(statusRes.status);
        }
    } catch (e) {
        console.error('Lỗi loadDiscordSettingsUI:', e);
    }
}

async function saveDiscordConfigUI() {
    const token = document.getElementById('discord-bot-token')?.value?.trim() || '';
    const channelId = document.getElementById('discord-channel-id')?.value?.trim() || '';
    const debounceSeconds = document.getElementById('discord-debounce-range')?.value || '60';

    if (!token) {
        showToast('Vui lòng nhập Discord Bot Token!', 'warning');
        return;
    }
    if (!channelId) {
        showToast('Vui lòng nhập Channel ID kênh nhận bài!', 'warning');
        return;
    }

    try {
        await window.electronApi.saveSettings({
            discord_bot_token: token,
            discord_channel_id: channelId,
            discord_debounce_seconds: debounceSeconds
        });
        showToast('Đã lưu cấu hình Discord Bot thành công!', 'success');
    } catch (e) {
        showToast('Lỗi lưu cấu hình: ' + e.message, 'error');
    }
}

async function toggleDiscordBotUI() {
    try {
        const statusRes = await window.electronApi.getDiscordStatus();
        const isConnected = statusRes?.status?.isConnected;

        if (isConnected) {
            // Dừng bot
            const res = await window.electronApi.stopDiscordBot();
            if (res.success) {
                showToast('Đã dừng Bot Discord.', 'info');
                updateDiscordStatusUI({ isConnected: false });
            } else {
                showToast('Lỗi khi dừng bot: ' + res.error, 'error');
            }
        } else {
            // Khởi động bot
            const token = document.getElementById('discord-bot-token')?.value?.trim();
            const channelId = document.getElementById('discord-channel-id')?.value?.trim();
            const debounceSeconds = document.getElementById('discord-debounce-range')?.value || '60';

            if (!token || !channelId) {
                showToast('Vui lòng nhập Token và Channel ID trước khi khởi động!', 'warning');
                return;
            }

            showToast('Đang kết nối Discord Bot...', 'info');
            const res = await window.electronApi.startDiscordBot({ token, channelId, debounceSeconds });
            if (res.success) {
                showToast(`✓ Bot ${res.botName} đã online và đang lắng nghe kênh!`, 'success');
                updateDiscordStatusUI({ isConnected: true, botName: res.botName, channelId });
            } else {
                showToast('Không thể kết nối Discord: ' + res.error, 'error');
            }
        }
    } catch (e) {
        showToast('Lỗi: ' + e.message, 'error');
    }
}


