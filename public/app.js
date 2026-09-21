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
    else if (tabId === 'zalo-groups') loadZaloGroups();
    else if (tabId === 'ai') loadAiSettings();
    else if (tabId === 'settings') loadGeneralSettings();
    else if (tabId === 'logs') loadLogs();
}

async function loadInitialData() {
    await Promise.all([
        loadStatus(),
        loadPosts(),
        loadFbGroups(),
        loadZaloGroups(),
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

                function isValidName(str) {
                    if (!str || str.length < 2) return false;
                    if (/^\\d{1,2}:\\d{2}$/.test(str)) return false;
                    if (/^\\d+\\s*(ngày|giờ|phút|giây|tháng)/.test(str)) return false;
                    var lower = str.toLowerCase().trim();
                    var systemWords = ['ưu tiên', 'khác', 'zalo', 'cloud của tôi', 'truyền file', 'hôm qua', 'vừa xong', 'đã gửi', 'tin nhắn', 'danh bạ'];
                    if (systemWords.indexOf(lower) !== -1) return false;
                    return true;
                }

                function extractNameFromRow(row) {
                    // 1. Thử các selector title chuẩn
                    var titleEl = row.querySelector('.conv-item-title__more, [class*="conv-item-title"], [class*="title"], [class*="name"], h4, h5, [data-id="chat-title"]');
                    if (titleEl && titleEl.innerText && titleEl.innerText.trim()) {
                        var t = titleEl.innerText.trim().split('\\n')[0].trim();
                        if (isValidName(t)) return t;
                    }

                    // 2. Tìm thẻ con có chữ in đậm (bold/strong) là tên nhóm
                    var allChildren = row.querySelectorAll('div, span, p, h4, strong, b');
                    for (var c = 0; c < allChildren.length; c++) {
                        var child = allChildren[c];
                        if (child.children.length === 0 && child.innerText && child.innerText.trim()) {
                            var text = child.innerText.trim();
                            if (isValidName(text)) {
                                var fw = window.getComputedStyle(child).fontWeight;
                                if (fw === 'bold' || fw === 'bolder' || parseInt(fw) >= 500) {
                                    return text;
                                }
                            }
                        }
                    }

                    // 3. Fallback: Lấy dòng đầu tiên trong innerText
                    var lines = (row.innerText || '').split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
                    for (var l = 0; l < lines.length; l++) {
                        if (isValidName(lines[l])) return lines[l];
                    }
                    return '';
                }

                // BƯỚC 1: KHÔNG CLICK BẤT KỲ TAB NÀO để tránh làm đổi tab của người dùng
                // Quét đúng danh sách các nhóm đang hiển thị trực tiếp trong mục Khác hiện tại

                // BƯỚC 2: Tìm container cuộn danh sách hội thoại
                var scrollContainer = null;
                var allDivs = document.querySelectorAll('div, ul, main, section');
                for (var d = 0; d < allDivs.length; d++) {
                    var el = allDivs[d];
                    var s = window.getComputedStyle(el);
                    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.clientHeight > 140) {
                        var rect = el.getBoundingClientRect();
                        if (rect.left < 500 && rect.width > 150) {
                            if (!scrollContainer || el.scrollHeight >= scrollContainer.scrollHeight) {
                                scrollContainer = el;
                            }
                        }
                    }
                }

                // BƯỚC 3: Hàm bóc tách hội thoại (Kết hợp cả Selector class lẫn Quét Hình Học)
                function harvestVisible() {
                    // A. Selector class
                    var rows = Array.from(document.querySelectorAll('.conv-item, [data-id*="conv"], [data-id*="thread"], div[class*="chat-item"], div[class*="conv-item"], div[class*="rel-item"], [role="listitem"]'));

                    // B. Geometrical fallback: tìm div dạng hàng hội thoại có avatar và text
                    if (rows.length === 0) {
                        var root = scrollContainer || document.body;
                        var allBoxes = Array.from(root.querySelectorAll('div'));
                        var customRows = [];
                        for (var b = 0; b < allBoxes.length; b++) {
                            var box = allBoxes[b];
                            var bRect = box.getBoundingClientRect();
                            if (bRect.height >= 45 && bRect.height <= 95 && bRect.width >= 160 && bRect.left < 450) {
                                var hasImg = box.querySelector('img, [class*="avatar"], svg, [class*="thumb"]');
                                if (hasImg) {
                                    customRows.push(box);
                                }
                            }
                        }
                        rows = customRows.filter(function(item, idx, arr) {
                            return !arr.some(function(other) { return other !== item && other.contains(item); });
                        });
                    }

                    for (var k = 0; k < rows.length; k++) {
                        var name = extractNameFromRow(rows[k]);
                        if (name) {
                            var key = name.toLowerCase();
                            if (!seen[key]) {
                                seen[key] = true;
                                names.push(name);
                            }
                        }
                    }
                }

                // Đưa container lên đầu
                if (scrollContainer) scrollContainer.scrollTop = 0;
                await new Promise(function(r) { setTimeout(r, 250); });
                harvestVisible();

                // BƯỚC 4: Cuộn 25 bước để lấy hết toàn bộ nhóm trong mục Khác
                var maxSteps = 25;
                for (var step = 1; step <= maxSteps; step++) {
                    if (scrollContainer) {
                        scrollContainer.scrollTop += 320;
                    } else {
                        window.scrollBy(0, 320);
                    }
                    await new Promise(function(r) { setTimeout(r, 220); });
                    harvestVisible();
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

                var container = document.querySelector('#conversationList, [data-id="virtual-list"], .conv-list, .virtualized-scroll, div[class*="conv-list"]');
                if (!container) {
                    var all = document.querySelectorAll('div');
                    for (var i = 0; i < all.length; i++) {
                        var el = all[i];
                        var rect = el.getBoundingClientRect();
                        if (rect.left < 450 && rect.width > 120 && rect.height > 250) {
                            var s = window.getComputedStyle(el);
                            if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
                                container = el;
                                break;
                            }
                        }
                    }
                }

                var names = [];
                var seen = {};

                function extractItems() {
                    var items = document.querySelectorAll('.conv-item, [data-id*="conv_item"], div[id^="conv-item-"], div[class*="chat-item"], div[class*="conv-item"], .group-item');
                    for (var k = 0; k < items.length; k++) {
                        var it = items[k];
                        var titleEl = it.querySelector('.conv-item-title__more, [class*="conv-item-title"], [class*="name"], [class*="title"], h4, p, span');
                        var name = titleEl ? titleEl.innerText.trim() : (it.getAttribute('title') || it.innerText.split('\\n')[0].trim());
                        if (name) {
                            var firstLine = name.split('\\n')[0].trim();
                            if (firstLine.length >= 2 && firstLine !== 'Zalo' && firstLine !== 'Cloud của tôi' && firstLine !== 'Truyền File') {
                                var key = firstLine.toLowerCase();
                                if (!seen[key]) {
                                    seen[key] = true;
                                    names.push(firstLine);
                                }
                            }
                        }
                    }
                }

                if (container) container.scrollTop = 0;
                await new Promise(function(r) { setTimeout(r, 250); });
                extractItems();

                var maxSteps = 20;
                for (var step = 1; step <= maxSteps; step++) {
                    if (container) {
                        container.scrollTop += 320;
                    } else {
                        window.scrollBy(0, 320);
                    }
                    await new Promise(function(r) { setTimeout(r, 250); });
                    extractItems();
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
            const savedModel = res.settings.gemini_model;
            const validModels = ['gemini-1.5-flash', 'gemini-3.6-flash', 'gemini-1.5-pro'];
            document.getElementById('ai-model-select').value = (validModels.includes(savedModel) ? savedModel : 'gemini-1.5-flash');
            document.getElementById('ai-prompt-input').value = res.settings.ai_prompt_template || '';
            const spinCheck = document.getElementById('ai-spin-enabled');
            if (spinCheck) spinCheck.checked = res.settings.ai_spin_enabled === '1';
            const sigInput = document.getElementById('ai-signature-input');
            if (sigInput) sigInput.value = res.settings.custom_signature || '';
            const tagInput = document.getElementById('ai-hashtags-input');
            if (tagInput) tagInput.value = res.settings.custom_hashtags || '';
        }
    } catch (e) {
        console.error('Error loadAiSettings:', e);
    }
}

async function saveAiConfig() {
    const key = document.getElementById('ai-key-input').value.trim();
    const model = document.getElementById('ai-model-select').value;
    const prompt = document.getElementById('ai-prompt-input').value.trim();
    const spinEnabled = document.getElementById('ai-spin-enabled')?.checked ? '1' : '0';
    const signature = document.getElementById('ai-signature-input')?.value || '';
    const hashtags = document.getElementById('ai-hashtags-input')?.value || '';

    await window.electronApi.saveSettings({
        gemini_api_key: key,
        gemini_model: model,
        ai_prompt_template: prompt,
        ai_spin_enabled: spinEnabled,
        custom_signature: signature,
        custom_hashtags: hashtags
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
        btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Đang Xử Lý...`;
        if (window.lucide) lucide.createIcons();
    }

    if (progressArea) progressArea.classList.remove('hidden');
    if (statusText) statusText.innerText = `Đang kết nối Zalo Web để quét tin trong ${days} ngày qua...`;
    if (counterText) counterText.innerText = 'Đang đọc...';
    if (progressBar) progressBar.style.width = '20%';

    try {
        const currentUrl = wv.getURL ? wv.getURL() : '';
        if (!currentUrl || !currentUrl.includes('zalo.me')) {
            showToast('Vui lòng mở Zalo Web và đăng nhập trước khi quét lịch sử!', 'error');
            if (statusText) statusText.innerText = '⚠️ Bạn chưa đăng nhập Zalo Web';
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Thử Lại`;
                if (window.lucide) lucide.createIcons();
            }
            return;
        }

        if (statusText) statusText.innerText = 'Đang trích xuất tin nhắn từ IndexedDB và lịch sử hội thoại...';
        if (progressBar) progressBar.style.width = '45%';

        // Chạy script trích xuất tin nhắn trực tiếp từ Webview Zalo
        const extractedMessages = await wv.executeJavaScript(`
            (async function(daysToScan) {
                const minTimestamp = Date.now() - (daysToScan * 24 * 60 * 60 * 1000);
                const results = [];
                const seenKeys = new Set();

                function record(groupName, sender, text, images, ts) {
                    if (!text || typeof text !== 'string') return;
                    const clean = text.trim();
                    if (clean.length < 20) return;
                    const key = (groupName || '') + '::' + clean.substring(0, 60);
                    if (seenKeys.has(key)) return;
                    seenKeys.add(key);
                    results.push({
                        groupName: (groupName || '').trim(),
                        sender: (sender || 'Thành viên').trim(),
                        text: clean,
                        images: images || [],
                        timestamp: ts || Date.now()
                    });
                }

                // 1. Quét từ IndexedDB của Zalo (Lưu cache offline toàn bộ tin nhắn)
                try {
                    if (window.indexedDB && window.indexedDB.databases) {
                        const dbs = await window.indexedDB.databases();
                        for (const dbInfo of dbs) {
                            if (!dbInfo.name) continue;
                            await new Promise((resolve) => {
                                const req = window.indexedDB.open(dbInfo.name);
                                req.onerror = () => resolve();
                                req.onsuccess = async (e) => {
                                    try {
                                        const db = e.target.result;
                                        const storeNames = Array.from(db.objectStoreNames || []);
                                        for (const sName of storeNames) {
                                            const lower = sName.toLowerCase();
                                            if (lower.includes('msg') || lower.includes('message') || lower.includes('chat')) {
                                                await new Promise((resStore) => {
                                                    try {
                                                        const tx = db.transaction(sName, 'readonly');
                                                        const store = tx.objectStore(sName);
                                                        const getReq = store.getAll ? store.getAll() : null;
                                                        if (getReq) {
                                                            getReq.onsuccess = () => {
                                                                const list = getReq.result || [];
                                                                for (const item of list) {
                                                                    const ts = item.ts || item.timestamp || item.createTime || item.cliMsgId || item.time || 0;
                                                                    if (ts && ts > 0 && ts < minTimestamp) continue;

                                                                    let content = '';
                                                                    if (typeof item.message === 'string') content = item.message;
                                                                    else if (typeof item.content === 'string') content = item.content;
                                                                    else if (typeof item.text === 'string') content = item.text;
                                                                    else if (item.msg && typeof item.msg === 'string') content = item.msg;
                                                                    else if (item.desc && typeof item.desc === 'string') content = item.desc;

                                                                    const gName = item.threadName || item.groupName || item.displayName || item.title || '';
                                                                    const sender = item.senderName || item.fromName || item.sender || 'Thành viên';

                                                                    if (content) {
                                                                        record(gName, sender, content, [], ts);
                                                                    }
                                                                }
                                                                resStore();
                                                            };
                                                            getReq.onerror = () => resStore();
                                                        } else {
                                                            resStore();
                                                        }
                                                    } catch (err) {
                                                        resStore();
                                                    }
                                                });
                                            }
                                        }
                                        db.close();
                                        resolve();
                                    } catch (err) {
                                        resolve();
                                    }
                                };
                            });
                        }
                    }
                } catch (e) {
                    console.warn('[ZaloHistoryScanner] Lỗi đọc IDB:', e);
                }

                // 2. Quét từ DOM chat đang mở và tự động cuộn lên tải tin cũ
                try {
                    let activeGroupName = '';
                    const titleSelectors = ['#header-title', '.header-title', '.chat-title', '[data-id="chat-title"]', '.conv-item.active .conv-item-title__more'];
                    for (const sel of titleSelectors) {
                        const el = document.querySelector(sel);
                        if (el && el.innerText && el.innerText.trim()) {
                            activeGroupName = el.innerText.trim();
                            break;
                        }
                    }

                    function harvestDom() {
                        const msgEls = document.querySelectorAll('.chat-message, .msg-view, [id^="msg-"], div[class*="message-view"], div[data-id*="msg"]');
                        msgEls.forEach((el) => {
                            const senderEl = el.querySelector('.sender-name, [class*="sender"], [class*="author"]');
                            const sender = senderEl ? senderEl.innerText.trim() : 'Thành viên';
                            const textEl = el.querySelector('.content-text, .msg-text, [class*="content-text"], [class*="text-msg"]');
                            const text = textEl ? textEl.innerText.trim() : '';

                            if (!text || text.length < 20) return;

                            const images = [];
                            el.querySelectorAll('img').forEach((img) => {
                                const src = img.getAttribute('src');
                                if (src && !src.includes('avatar') && !src.includes('icon') && !src.includes('emoji')) {
                                    images.push(src);
                                }
                            });

                            record(activeGroupName || 'Nhóm Zalo Đang Mở', sender, text, images, Date.now());
                        });
                    }

                    harvestDom();

                    // Tìm khung cuộn tin nhắn để cuộn lên trên vài nhịp
                    let scrollable = document.querySelector('.chat-date, .message-view__body, [class*="message-list"], #messageView');
                    if (!scrollable) {
                        const divs = document.querySelectorAll('div');
                        for (let d of divs) {
                            if (d.scrollHeight > d.clientHeight && d.clientHeight > 250) {
                                const s = window.getComputedStyle(d);
                                if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
                                    scrollable = d;
                                    break;
                                }
                            }
                        }
                    }

                    if (scrollable) {
                        for (let step = 0; step < 4; step++) {
                            scrollable.scrollTop = 0;
                            await new Promise(r => setTimeout(r, 450));
                            harvestDom();
                        }
                    }
                } catch (e) {
                    console.warn('[ZaloHistoryScanner] Lỗi DOM chat:', e);
                }

                return results;
            })(${days});
        `);

        const messagesCount = Array.isArray(extractedMessages) ? extractedMessages.length : 0;
        if (statusText) statusText.innerText = `Thu thập được ${messagesCount} tin. Đang lọc & gửi AI biên tập...`;
        if (counterText) counterText.innerText = `${messagesCount} tin`;
        if (progressBar) progressBar.style.width = '70%';

        if (messagesCount === 0) {
            showToast('Không tìm thấy tin nhắn nào thỏa điều kiện trong khoảng thời gian đã chọn!', 'info');
            if (statusText) statusText.innerText = 'Không tìm thấy tin nhắn mới để xử lý.';
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Bắt Đầu Quét & Nạp`;
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
                ignoreGroupFilter: scope === 'all'
            }
        });

        if (progressBar) progressBar.style.width = '100%';
        if (statusText) statusText.innerText = `Hoàn tất! Đã nạp ${result.queued || 0} bài vào hàng đợi để đăng dần.`;
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

