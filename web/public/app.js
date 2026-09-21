// State quản lý toàn cục của Web Dashboard
const state = {
    currentTab: 'dashboard',
    settings: {},
    stats: {},
    zaloGroups: [],
    fbGroups: [],
    posts: [],
    logs: []
};

// Khởi chạy khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initSSE();
    loadAllData();
});

// Chuyển đổi giữa các Tab
function switchTab(tabId) {
    state.currentTab = tabId;

    // Ẩn toàn bộ tab content
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`tab-${tabId}`);
    if (target) target.classList.remove('hidden');

    // Cập nhật trạng thái nút bấm sidebar
    document.querySelectorAll('#nav-tabs button').forEach(btn => {
        btn.className = "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-all";
    });
    const activeBtn = document.getElementById(`tab-btn-${tabId}`);
    if (activeBtn) {
        activeBtn.className = "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all bg-blue-600 text-white shadow-sm";
    }

    // Tiêu đề trang
    const titles = {
        dashboard: { title: 'Tổng Quan Hệ Thống', sub: 'Giám sát và kiểm soát toàn bộ quy trình lấy tin, viết lại bài và đăng lên Facebook.' },
        zalo: { title: 'Zalo Monitor', sub: 'Quản lý các nhóm Zalo cần lấy tin và theo dõi tin nhắn theo thời gian thực.' },
        ai: { title: 'Google Gemini AI', sub: 'Tùy chỉnh Prompt, chọn model AI và thử nghiệm viết lại bài đăng hấp dẫn.' },
        facebook: { title: 'Facebook & Hàng Đợi', sub: 'Quản lý nhóm Facebook mục tiêu, duyệt và xuất bản bài viết tự động.' },
        settings: { title: 'Cài Đặt & Kết Nối', sub: 'Hướng dẫn cài đặt Zalo Bridge vào trình duyệt và tùy chỉnh tham số hệ thống.' }
    };
    if (titles[tabId]) {
        document.getElementById('page-title').innerText = titles[tabId].title;
        document.getElementById('page-subtitle').innerText = titles[tabId].sub;
    }

    lucide.createIcons();
    refreshCurrentTabData();
}

function refreshCurrentTab() {
    loadAllData();
    showToast('Đã làm mới dữ liệu!', 'success');
}

function refreshCurrentTabData() {
    if (state.currentTab === 'dashboard') {
        loadStatus();
        loadRecentPosts();
        loadLogs();
    } else if (state.currentTab === 'zalo') {
        loadZaloGroups();
    } else if (state.currentTab === 'ai') {
        loadSettings();
    } else if (state.currentTab === 'facebook') {
        loadFbGroups();
        loadPostsQueue();
    } else if (state.currentTab === 'settings') {
        loadSettings();
    }
}

// Tải tất cả dữ liệu ban đầu
async function loadAllData() {
    await Promise.all([
        loadStatus(),
        loadSettings(),
        loadZaloGroups(),
        loadFbGroups(),
        loadPostsQueue(),
        loadLogs()
    ]);
}

// Kết nối Server-Sent Events (SSE) để cập nhật thời gian thực
function initSSE() {
    const sseStatus = document.getElementById('sse-status');
    const evtSource = new EventSource('/api/events');

    evtSource.onopen = () => {
        sseStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Trực tuyến`;
        sseStatus.className = "inline-flex items-center gap-1.5 text-emerald-400 font-semibold";
    };

    evtSource.onerror = () => {
        sseStatus.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-400"></span> Mất kết nối`;
        sseStatus.className = "inline-flex items-center gap-1.5 text-rose-400 font-semibold";
    };

    evtSource.addEventListener('new_zalo_message', (e) => {
        const data = JSON.parse(e.data);
        appendZaloMessageFeed(data);
        loadStatus();
    });

    evtSource.addEventListener('new_post_ready', (e) => {
        const data = JSON.parse(e.data);
        loadPostsQueue();
        loadStatus();
        showToast(`AI vừa tạo bài mới từ [${data.groupName}]!`, 'info');
    });

    evtSource.addEventListener('post_published', (e) => {
        loadPostsQueue();
        loadStatus();
        showToast(`Đã xuất bản bài viết #${e.data.id} lên Facebook!`, 'success');
    });
}

// 1. Thống kê & Trạng thái
async function loadStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        if (data.success) {
            state.stats = data.stats;
            document.getElementById('stat-messages').innerText = data.stats.messagesToday;
            document.getElementById('stat-posts').innerText = data.stats.postsToday;
            document.getElementById('stat-pending').innerText = data.stats.pendingPosts;
            document.getElementById('stat-posted').innerText = data.stats.postedPosts;

            const toggleBtn = document.getElementById('quick-auto-toggle');
            if (data.stats.autoPostEnabled) {
                toggleBtn.innerText = 'Đang bật';
                toggleBtn.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-600 text-white transition-colors';
            } else {
                toggleBtn.innerText = 'Đang tắt';
                toggleBtn.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-slate-700 text-slate-300 transition-colors';
            }
        }
    } catch (e) {
        console.error('Error loadStatus:', e);
    }
}

async function toggleAutoPost() {
    const isCurrentlyOn = state.stats.autoPostEnabled;
    const newVal = isCurrentlyOn ? '0' : '1';
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { auto_post_enabled: newVal } })
    });
    showToast(newVal === '1' ? 'Đã BẬT chế độ Tự động đăng bài!' : 'Đã TẮT chế độ Tự động đăng bài.', 'info');
    loadStatus();
}

// 2. Nhóm Zalo
async function loadZaloGroups() {
    try {
        const res = await fetch('/api/zalo/groups');
        const data = await res.json();
        if (data.success) {
            state.zaloGroups = data.groups;
            renderZaloGroups();
        }
    } catch (e) {
        console.error('Error loadZaloGroups:', e);
    }
}

function renderZaloGroups() {
    const container = document.getElementById('zalo-groups-list');
    if (state.zaloGroups.length === 0) {
        container.innerHTML = `<div class="col-span-full py-6 text-center text-slate-400 text-xs bg-slate-50 border border-dashed border-slate-200 rounded-lg">Chưa có nhóm nào. Hãy thêm tên nhóm Zalo bạn muốn thu thập tin ở ô phía trên.</div>`;
        return;
    }
    container.innerHTML = state.zaloGroups.map(g => `
        <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between shadow-xs">
            <div class="flex items-center gap-2.5 overflow-hidden">
                <div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <i data-lucide="users" class="w-4 h-4"></i>
                </div>
                <div class="truncate">
                    <h4 class="font-bold text-xs text-slate-800 truncate">${escapeHtml(g.name)}</h4>
                    <span class="text-[10px] text-emerald-600 font-medium">✓ Đang theo dõi</span>
                </div>
            </div>
            <button onclick="deleteZaloGroup(${g.id})" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Xóa nhóm">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
        </div>
    `).join('');
    lucide.createIcons();
}

async function addZaloGroup() {
    const input = document.getElementById('new-zalo-group-input');
    const name = input.value.trim();
    if (!name) return;
    const res = await fetch('/api/zalo/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (data.success) {
        input.value = '';
        showToast('Đã thêm nhóm Zalo theo dõi!', 'success');
        loadZaloGroups();
    } else {
        showToast(data.error, 'error');
    }
}

async function deleteZaloGroup(id) {
    if (!confirm('Bạn có chắc muốn bỏ theo dõi nhóm Zalo này?')) return;
    await fetch(`/api/zalo/groups/${id}`, { method: 'DELETE' });
    showToast('Đã xóa nhóm Zalo!', 'info');
    loadZaloGroups();
}

function appendZaloMessageFeed(msg) {
    const container = document.getElementById('zalo-messages-feed');
    const emptyMsg = container.querySelector('.text-center');
    if (emptyMsg) container.innerHTML = '';

    const div = document.createElement('div');
    div.className = 'p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5 shadow-xs animate-fadeIn';
    div.innerHTML = `
        <div class="flex items-center justify-between text-xs">
            <span class="font-bold text-blue-700 flex items-center gap-1.5">
                <i data-lucide="message-square" class="w-3.5 h-3.5"></i> ${escapeHtml(msg.groupName)}
            </span>
            <span class="text-[10px] text-slate-400 font-mono">${msg.time || 'Vừa xong'}</span>
        </div>
        <div class="text-[11px] text-slate-500 font-medium">Người gửi: ${escapeHtml(msg.sender)}</div>
        <div class="text-xs text-slate-800 whitespace-pre-wrap">${escapeHtml(msg.content)}</div>
    `;
    container.prepend(div);
    lucide.createIcons();
}

// 3. Nhóm Facebook
async function loadFbGroups() {
    try {
        const res = await fetch('/api/fb/groups');
        const data = await res.json();
        if (data.success) {
            state.fbGroups = data.groups;
            renderFbGroups();
        }
    } catch (e) {
        console.error('Error loadFbGroups:', e);
    }
}

function renderFbGroups() {
    const container = document.getElementById('fb-groups-list');
    if (state.fbGroups.length === 0) {
        container.innerHTML = `<div class="col-span-full py-6 text-center text-slate-400 text-xs bg-slate-50 border border-dashed border-slate-200 rounded-lg">Chưa có nhóm Facebook nào. Hãy thêm nhóm bạn muốn đăng bài ở ô trên.</div>`;
        return;
    }
    container.innerHTML = state.fbGroups.map(g => `
        <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between shadow-xs">
            <div class="flex items-center gap-2.5 overflow-hidden">
                <div class="w-8 h-8 rounded-lg ${g.is_active ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'} flex items-center justify-center shrink-0">
                    <i data-lucide="share-2" class="w-4 h-4"></i>
                </div>
                <div class="truncate">
                    <h4 class="font-bold text-xs text-slate-800 truncate">${escapeHtml(g.name)}</h4>
                    <a href="${escapeHtml(g.url)}" target="_blank" class="text-[10px] text-blue-500 hover:underline truncate block">${escapeHtml(g.url)}</a>
                </div>
            </div>
            <div class="flex items-center gap-1">
                <button onclick="toggleFbGroup(${g.id})" class="p-1.5 rounded-lg text-xs font-semibold ${g.is_active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-200'}" title="${g.is_active ? 'Tắt đăng vào nhóm này' : 'Bật đăng vào nhóm này'}">
                    <i data-lucide="${g.is_active ? 'check-circle-2' : 'circle'}" class="w-4 h-4"></i>
                </button>
                <button onclick="deleteFbGroup(${g.id})" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Xóa nhóm">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

async function addFbGroup() {
    const nameInput = document.getElementById('new-fb-name-input');
    const urlInput = document.getElementById('new-fb-url-input');
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    if (!name || !url) {
        showToast('Vui lòng điền đủ tên nhóm và link Facebook!', 'error');
        return;
    }
    const res = await fetch('/api/fb/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url })
    });
    const data = await res.json();
    if (data.success) {
        nameInput.value = '';
        urlInput.value = '';
        showToast('Đã thêm nhóm Facebook!', 'success');
        loadFbGroups();
    } else {
        showToast(data.error, 'error');
    }
}

async function toggleFbGroup(id) {
    await fetch(`/api/fb/groups/${id}/toggle`, { method: 'PUT' });
    loadFbGroups();
}

async function deleteFbGroup(id) {
    if (!confirm('Bạn có chắc muốn xóa nhóm Facebook này?')) return;
    await fetch(`/api/fb/groups/${id}`, { method: 'DELETE' });
    showToast('Đã xóa nhóm Facebook!', 'info');
    loadFbGroups();
}

// 4. Hàng đợi bài viết & Đăng bài
async function loadPostsQueue() {
    try {
        const res = await fetch('/api/posts');
        const data = await res.json();
        if (data.success) {
            state.posts = data.posts;
            renderPostsQueue();
            renderRecentPostsDashboard();
        }
    } catch (e) {
        console.error('Error loadPostsQueue:', e);
    }
}

function renderPostsQueue() {
    const container = document.getElementById('posts-queue-list');
    const filter = document.getElementById('post-filter')?.value || 'all';

    let filtered = state.posts;
    if (filter !== 'all') {
        filtered = filtered.filter(p => p.status === filter);
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="py-8 text-center text-slate-400 text-xs bg-slate-50 border border-dashed border-slate-200 rounded-lg">Không có bài viết nào phù hợp trong hàng đợi.</div>`;
        return;
    }

    container.innerHTML = filtered.map(p => `
        <div class="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3 shadow-xs">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="font-bold text-xs text-slate-800">#${p.id}</span>
                    <span class="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                        ${escapeHtml(p.group_name || 'Zalo')}
                    </span>
                    <span class="status-badge status-${p.status}">
                        ${getStatusLabel(p.status)}
                    </span>
                </div>
                <div class="text-[11px] text-slate-400 font-mono">${formatDate(p.created_at)}</div>
            </div>

            <!-- Preview nội dung viết lại -->
            <div class="bg-white p-3.5 rounded-lg border border-slate-200 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                ${escapeHtml(p.rewritten_text || p.original_text || '')}
            </div>

            <div class="flex items-center justify-between text-xs pt-1">
                <span class="text-slate-500">Đích: <b class="text-slate-700">${escapeHtml(p.target_fb_group || 'Tất cả nhóm')}</b></span>
                <div class="flex items-center gap-2">
                    <button onclick="openEditModal(${p.id})" class="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold hover:bg-slate-50 flex items-center gap-1 transition-all">
                        <i data-lucide="edit-2" class="w-3.5 h-3.5"></i> Sửa
                    </button>
                    ${p.status !== 'posted' ? `
                        <button onclick="publishPostDirect(${p.id})" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-sm transition-all">
                            <i data-lucide="send" class="w-3.5 h-3.5"></i> Đăng Ngay
                        </button>
                    ` : `
                        <span class="text-emerald-600 font-semibold flex items-center gap-1">
                            <i data-lucide="check" class="w-4 h-4"></i> Đã đăng
                        </span>
                    `}
                </div>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

function renderRecentPostsDashboard() {
    const container = document.getElementById('dashboard-recent-posts');
    const recent = state.posts.slice(0, 3);
    if (recent.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-slate-400 text-sm">Chưa có bài viết nào trong hàng đợi.</div>`;
        return;
    }
    container.innerHTML = recent.map(p => `
        <div class="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
            <div class="overflow-hidden pr-3">
                <div class="flex items-center gap-2 mb-1">
                    <span class="font-bold text-xs text-blue-700 truncate">${escapeHtml(p.group_name)}</span>
                    <span class="status-badge status-${p.status}">${getStatusLabel(p.status)}</span>
                </div>
                <p class="text-xs text-slate-600 line-clamp-1">${escapeHtml(p.rewritten_text || p.original_text)}</p>
            </div>
            <button onclick="openEditModal(${p.id})" class="shrink-0 text-xs text-blue-600 hover:underline font-semibold">Xem & Đăng</button>
        </div>
    `).join('');
}

// 5. Cấu hình AI Gemini
async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.success) {
            state.settings = data.settings;
            // Tab AI
            if (document.getElementById('gemini-key-input')) {
                document.getElementById('gemini-key-input').value = data.settings.gemini_api_key || '';
                document.getElementById('gemini-model-select').value = data.settings.gemini_model || 'gemini-1.5-flash';
                document.getElementById('gemini-prompt-input').value = data.settings.ai_prompt_template || '';
            }
            // Tab Settings
            if (document.getElementById('setting-auto-post')) {
                document.getElementById('setting-auto-post').value = data.settings.auto_post_enabled || '0';
                document.getElementById('setting-fb-mode').value = data.settings.fb_posting_mode || 'assisted';
                document.getElementById('setting-delay-min').value = data.settings.delay_min_seconds || '180';
                document.getElementById('setting-delay-max').value = data.settings.delay_max_seconds || '480';
            }
        }
    } catch (e) {
        console.error('Error loadSettings:', e);
    }
}

async function saveAiSettings() {
    const apiKey = document.getElementById('gemini-key-input').value.trim();
    const model = document.getElementById('gemini-model-select').value;
    const promptTemplate = document.getElementById('gemini-prompt-input').value.trim();

    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            settings: {
                gemini_api_key: apiKey,
                gemini_model: model,
                ai_prompt_template: promptTemplate
            }
        })
    });
    showToast('Đã lưu cấu hình Google Gemini AI!', 'success');
}

async function testAiConnection() {
    const apiKey = document.getElementById('gemini-key-input').value.trim();
    const model = document.getElementById('gemini-model-select').value;
    const promptTemplate = document.getElementById('gemini-prompt-input').value.trim();

    if (!apiKey) {
        showToast('Vui lòng nhập API Key trước khi thử nghiệm!', 'error');
        return;
    }

    showToast('Đang gọi thử nghiệm Gemini AI...', 'info');
    const resultBox = document.getElementById('ai-test-result-box');
    const output = document.getElementById('ai-test-output');
    const status = document.getElementById('ai-test-status');

    try {
        const res = await fetch('/api/ai/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model, promptTemplate })
        });
        const data = await res.json();
        resultBox.classList.remove('hidden');
        if (data.success) {
            status.innerText = '✓ Kết nối thành công';
            status.className = 'text-emerald-600 font-semibold';
            output.innerText = data.result;
            showToast('Kiểm tra Gemini thành công!', 'success');
        } else {
            status.innerText = '✗ Thất bại';
            status.className = 'text-rose-600 font-semibold';
            output.innerText = data.error;
            showToast(data.error, 'error');
        }
    } catch (e) {
        showToast('Lỗi mạng: ' + e.message, 'error');
    }
}

async function saveGeneralSettings() {
    const autoPost = document.getElementById('setting-auto-post').value;
    const fbMode = document.getElementById('setting-fb-mode').value;
    const delayMin = document.getElementById('setting-delay-min').value;
    const delayMax = document.getElementById('setting-delay-max').value;

    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            settings: {
                auto_post_enabled: autoPost,
                fb_posting_mode: fbMode,
                delay_min_seconds: delayMin,
                delay_max_seconds: delayMax
            }
        })
    });
    showToast('Đã lưu cấu hình hoạt động hệ thống!', 'success');
    loadStatus();
}

// 6. Modal Edit & Publish
function openEditModal(postId) {
    const post = state.posts.find(p => p.id === postId);
    if (!post) return;
    document.getElementById('modal-post-id').value = post.id;
    document.getElementById('modal-original-text').innerText = post.original_text || '(Không có nội dung gốc)';
    document.getElementById('modal-rewritten-text').value = post.rewritten_text || post.original_text || '';
    document.getElementById('edit-post-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-post-modal').classList.add('hidden');
}

async function savePostEdit() {
    const id = document.getElementById('modal-post-id').value;
    const rewritten_text = document.getElementById('modal-rewritten-text').value;
    await fetch(`/api/posts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewritten_text })
    });
    closeEditModal();
    showToast('Đã lưu nội dung bài viết!', 'success');
    loadPostsQueue();
}

async function publishPostDirect(id) {
    showToast('Đang tiến hành xuất bản bài viết...', 'info');
    try {
        const res = await fetch(`/api/posts/${id}/publish`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            closeEditModal();
            showToast('Đã xuất bản bài viết thành công!', 'success');
            loadPostsQueue();
            loadStatus();
        } else {
            showToast('Lỗi đăng bài: ' + data.error, 'error');
        }
    } catch (e) {
        showToast('Lỗi mạng: ' + e.message, 'error');
    }
}

async function deletePost(id) {
    if (!confirm('Bạn có chắc muốn xóa bài viết này?')) return;
    await fetch(`/api/posts/${id}`, { method: 'DELETE' });
    closeEditModal();
    showToast('Đã xóa bài viết khỏi hàng đợi!', 'info');
    loadPostsQueue();
    loadStatus();
}

// 7. Nhật ký (Logs)
async function loadLogs() {
    try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        if (data.success) {
            state.logs = data.logs;
            const container = document.getElementById('dashboard-logs');
            if (data.logs.length === 0) {
                container.innerHTML = `<div class="text-slate-500">Chưa có nhật ký hoạt động.</div>`;
                return;
            }
            container.innerHTML = data.logs.slice(0, 30).map(l => `
                <div class="leading-relaxed border-b border-slate-800/50 pb-1">
                    <span class="text-slate-500">[${formatDate(l.created_at)}]</span>
                    <span class="${l.level === 'error' ? 'text-rose-400 font-bold' : (l.level === 'warn' ? 'text-amber-400' : 'text-emerald-400')}">[${l.level.toUpperCase()}]</span>
                    <span>${escapeHtml(l.message)}</span>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error('Error loadLogs:', e);
    }
}

// Helpers
function getStatusLabel(status) {
    const labels = {
        pending: 'Chờ duyệt',
        approved: 'Đã duyệt (Chờ đăng)',
        posted: 'Đã đăng xong',
        failed: 'Lỗi khi đăng'
    };
    return labels[status] || status;
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

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-emerald-600 text-white',
        error: 'bg-rose-600 text-white',
        info: 'bg-slate-900 text-white'
    };
    toast.className = `fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 ${colors[type] || colors.info} transition-all duration-300 transform translate-y-3 opacity-0`;
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-y-3', 'opacity-0');
    }, 10);

    setTimeout(() => {
        toast.classList.add('translate-y-3', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
