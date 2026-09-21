// State quản lý giao diện Desktop
const state = {
    currentTab: 'feed',
    status: {},
    settings: {},
    posts: [],
    fbGroups: [],
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

    window.electronApi.on('new-log-entry', (log) => {
        appendLogEntry(log);
    });
}

// Chuyển Tab giao diện
function switchTab(tabId) {
    state.currentTab = tabId;

    // 1. Cập nhật hiển thị Pane (Ẩn hoàn toàn các pane khác)
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.remove('active');
        p.style.setProperty('display', 'none', 'important');
        p.style.setProperty('visibility', 'hidden', 'important');
        p.style.setProperty('pointer-events', 'none', 'important');
        p.style.setProperty('z-index', '1', 'important');
    });

    const target = document.getElementById(`tab-${tabId}`);
    if (target) {
        target.classList.add('active');
        const displayMode = target.classList.contains('tab-block') ? 'block' : 'flex';
        target.style.setProperty('display', displayMode, 'important');
        target.style.setProperty('visibility', 'visible', 'important');
        target.style.setProperty('pointer-events', 'auto', 'important');
        target.style.setProperty('z-index', '10', 'important');
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
        ai: { title: 'CẤU HÌNH AI GEMINI', sub: 'Thiết lập Prompt biên tập nội dung bài đăng' },
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
    else if (tabId === 'ai') loadAiSettings();
    else if (tabId === 'settings') loadGeneralSettings();
    else if (tabId === 'logs') loadLogs();
}

async function loadInitialData() {
    await Promise.all([
        loadStatus(),
        loadPosts(),
        loadFbGroups(),
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

function setFilter(filterType) {
    state.filter = filterType;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.getElementById(`filter-btn-${filterType}`);
    if (activeBtn) activeBtn.classList.add('active');
    renderPosts();
}

function renderPosts() {
    const container = document.getElementById('feed-posts-container');
    let filtered = state.posts;
    if (state.filter !== 'all') {
        filtered = filtered.filter(p => p.status === state.filter);
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="py-16 text-center text-slate-500 bg-slate-950/40 rounded-xl border border-dashed border-slate-800 space-y-2">
                <i data-lucide="inbox" class="w-8 h-8 mx-auto text-slate-600"></i>
                <p class="text-xs font-semibold">Chưa có bài viết nào trong danh mục này.</p>
                <p class="text-[11px] text-slate-600">Khi có tin nhắn mới từ nhóm Zalo theo dõi, bài viết sẽ tự động xuất hiện tại đây.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = filtered.map(p => `
        <div class="p-5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-4 shadow-sm hover:border-slate-700 transition-all">
            <!-- Header bài viết -->
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2.5">
                    <span class="font-extrabold text-xs text-blue-400">#${p.id}</span>
                    <span class="text-xs font-bold text-slate-200 bg-slate-800 px-2.5 py-0.5 rounded-md border border-slate-700">
                        ${escapeHtml(p.group_name || 'Nhóm Zalo')}
                    </span>
                    <span class="status-badge status-${p.status}">
                        ${getStatusLabel(p.status)}
                    </span>
                </div>
                <div class="text-[11px] text-slate-500 font-mono">${formatDate(p.created_at)}</div>
            </div>

            <!-- Khung so sánh nội dung: Zalo Gốc -> AI Viết Lại -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div class="p-3 bg-slate-900/90 rounded-lg border border-slate-800/80 space-y-1">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <i data-lucide="message-square" class="w-3 h-3 text-blue-400"></i> Tin nhắn Zalo gốc:
                    </div>
                    <div class="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto font-sans">
                        ${escapeHtml(p.original_text || '(Không có nội dung)')}
                    </div>
                </div>

                <div class="p-3.5 bg-blue-950/20 rounded-lg border border-blue-900/40 space-y-1">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1">
                        <i data-lucide="sparkles" class="w-3 h-3 text-amber-400"></i> Nội dung AI đã biên tập:
                    </div>
                    <div class="text-xs text-slate-100 whitespace-pre-wrap leading-relaxed font-sans">
                        ${escapeHtml(p.rewritten_text || p.original_text || '')}
                    </div>
                </div>
            </div>

            <!-- Footer bài viết: Nhóm đích & Nút hành động -->
            <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
                <div class="text-slate-400 text-[11px]">
                    Đích đăng: <b class="text-slate-200">${escapeHtml(p.target_fb_group || 'Các nhóm Facebook đã chọn')}</b>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="openEditModal(${p.id})" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg flex items-center gap-1.5 transition-all">
                        <i data-lucide="edit-2" class="w-3.5 h-3.5 text-blue-400"></i> Sửa bài
                    </button>
                    ${p.status !== 'posted' ? `
                        <button onclick="publishPostDirect(${p.id})" class="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg flex items-center gap-1.5 shadow-sm transition-all">
                            <i data-lucide="send" class="w-3.5 h-3.5"></i> Duyệt & Đăng Luôn
                        </button>
                    ` : `
                        <span class="text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
                            <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Đã đăng thành công
                        </span>
                    `}
                </div>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

function refreshPosts() {
    loadPosts();
    showToast('Đã làm mới hàng đợi!', 'info');
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
    } else {
        showToast(res.error, 'error');
    }
}

function reloadZaloWebview() {
    const wv = document.getElementById('zalo-wv');
    if (wv) wv.reload();
}

// 4. Facebook Webview Controls
async function triggerFbGroupScan() {
    const wv = document.getElementById('fb-wv');
    if (!wv) return;

    try {
        const currentUrl = wv.getURL();
        if (!currentUrl || currentUrl === 'about:blank' || !currentUrl.includes('facebook.com')) {
            showToast('Đang mở Facebook... Vui lòng đăng nhập tài khoản trước khi quét!', 'info');
            wv.loadURL('https://www.facebook.com/groups/joins/');
            return;
        }

        if (!currentUrl.includes('/groups')) {
            showToast('Đang mở trang Danh Sách Nhóm và quét...', 'info');
            wv.loadURL('https://www.facebook.com/groups/joins/');
            wv.addEventListener('did-finish-load', function onLoaded() {
                wv.removeEventListener('did-finish-load', onLoaded);
                setTimeout(() => executeScanOnFbWebview(wv), 2000);
            });
            return;
        }

        await executeScanOnFbWebview(wv);

    } catch (e) {
        console.error('Lỗi triggerFbGroupScan:', e);
        showToast('Lỗi: ' + e.message, 'error');
    }
}

async function executeScanOnFbWebview(wv) {
    showToast('Đang quét danh sách nhóm Facebook trên trang...', 'info');
    try {
        // Cuộn trang nhẹ xuống để nạp thêm các nhóm ẩn
        await wv.executeJavaScript(`window.scrollBy(0, 800);`);
        await new Promise(r => setTimeout(r, 400));
        await wv.executeJavaScript(`window.scrollBy(0, 1200);`);
        await new Promise(r => setTimeout(r, 600));

        // Trích xuất trực tiếp danh sách nhóm qua executeJavaScript
        const groups = await wv.executeJavaScript(`
            (function() {
                var foundGroups = [];
                var seenUrls = {};
                var excludedIds = [
                    'feed', 'discover', 'notifications', 'joins', 'create', 'search',
                    'your_groups', 'membership_questions', 'manage', 'chats', 'member',
                    'members', 'buy_sell_discussion', 'permalink', 'user', 'about'
                ];

                var links = document.querySelectorAll('a[href*="/groups/"]');
                for (var i = 0; i < links.length; i++) {
                    var a = links[i];
                    var href = a.getAttribute('href') || '';
                    var match = href.match(/\\/groups\\/([^/?#]+)/);
                    if (!match) continue;

                    var groupId = match[1];
                    if (excludedIds.indexOf(groupId) !== -1) continue;

                    var fullUrl = 'https://www.facebook.com/groups/' + groupId + '/';
                    if (seenUrls[fullUrl]) continue;
                    seenUrls[fullUrl] = true;

                    var rawText = (a.innerText || a.getAttribute('aria-label') || '').trim();
                    var lines = rawText.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
                    var name = lines[0] || ('Nhóm FB (' + groupId + ')');

                    if (name.indexOf('Xem tất cả') !== -1 || name.indexOf('Tạo nhóm') !== -1 || name.indexOf('http') === 0 || name.length < 2) {
                        continue;
                    }

                    var memberCount = '';
                    for (var j = 0; j < lines.length; j++) {
                        var l = lines[j];
                        if (l.indexOf('thành viên') !== -1 || l.toLowerCase().indexOf('member') !== -1 || l.indexOf('bài viết') !== -1) {
                            memberCount = l;
                            break;
                        }
                    }

                    foundGroups.push({
                        name: name,
                        url: fullUrl,
                        memberCount: memberCount
                    });
                }
                return foundGroups;
            })();
        `);

        if (Array.isArray(groups) && groups.length > 0) {
            await window.electronApi.forwardFbGroups(groups);
            showToast(`🎉 Đã quét thành công ${groups.length} nhóm Facebook!`, 'success');
            await loadFbGroups();
            setTimeout(() => switchTab('groups'), 800);
        } else {
            // Kiểm tra xem đã đăng nhập chưa
            const isLoginPage = await wv.executeJavaScript(`Boolean(document.querySelector('input[type="password"], input[name="pass"], #loginbutton, [data-testid="royal_login_button"]'))`);
            if (isLoginPage) {
                showToast('⚠️ Bạn chưa đăng nhập Facebook! Hãy đăng nhập tài khoản trên màn hình trước rồi bấm Quét lại.', 'error');
            } else {
                showToast('Chưa thấy nhóm nào trên trang này. Hãy chuyển sang tab Nhóm trên Facebook rồi bấm Quét lại.', 'info');
            }
        }
    } catch (err) {
        console.error('Lỗi executeScanOnFbWebview:', err);
        showToast('Lỗi khi quét: ' + err.message, 'error');
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
                    Chưa có nhóm nào. Hãy chuyển sang tab <b>Facebook</b> và bấm <b>"Quét Nhóm Đã Tham Gia"</b>.
                </td>
            </tr>
        `;
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

async function deleteFbGroupRow(id) {
    if (!confirm('Bạn có chắc muốn xóa nhóm này khỏi danh sách?')) return;
    await window.electronApi.deleteFbGroup(id);
    showToast('Đã xóa nhóm.', 'info');
    loadFbGroups();
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
            document.getElementById('ai-key-input').value = res.settings.gemini_api_key || '';
            document.getElementById('ai-model-select').value = res.settings.gemini_model || 'gemini-1.5-flash';
            document.getElementById('ai-prompt-input').value = res.settings.ai_prompt_template || '';
        }
    } catch (e) {
        console.error('Error loadAiSettings:', e);
    }
}

async function saveAiConfig() {
    const key = document.getElementById('ai-key-input').value.trim();
    const model = document.getElementById('ai-model-select').value;
    const prompt = document.getElementById('ai-prompt-input').value.trim();

    await window.electronApi.saveSettings({
        gemini_api_key: key,
        gemini_model: model,
        ai_prompt_template: prompt
    });
    showToast('Đã lưu cấu hình Google Gemini AI!', 'success');
}

async function testAiPrompt() {
    const key = document.getElementById('ai-key-input').value.trim();
    const model = document.getElementById('ai-model-select').value;
    const prompt = document.getElementById('ai-prompt-input').value.trim();

    if (!key) {
        showToast('Vui lòng nhập API Key trước khi thử nghiệm!', 'error');
        return;
    }

    showToast('Đang gọi AI Gemini viết thử...', 'info');
    const res = await window.electronApi.testAi(key, prompt, model);
    const box = document.getElementById('ai-test-preview-box');
    const out = document.getElementById('ai-test-output-text');
    const status = document.getElementById('ai-test-status-text');

    box.classList.remove('hidden');
    if (res.success) {
        status.innerText = '✓ Thành công';
        status.className = 'text-emerald-400 font-semibold';
        out.innerText = res.result;
        showToast('Thử nghiệm AI thành công!', 'success');
    } else {
        status.innerText = '✗ Thất bại';
        status.className = 'text-rose-400 font-semibold';
        out.innerText = res.error;
        showToast(res.error, 'error');
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

    await window.electronApi.saveSettings({
        auto_post_enabled: auto,
        emergency_stop: stop,
        delay_min_seconds: min,
        delay_max_seconds: max
    });
    showToast('Đã lưu cấu hình cài đặt hệ thống!', 'success');
    loadStatus();
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
    if (!confirm('Bạn có chắc muốn xóa bài viết này khỏi hàng đợi?')) return;
    await window.electronApi.deletePost(id);
    closePostModal();
    showToast('Đã xóa bài viết.', 'info');
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
