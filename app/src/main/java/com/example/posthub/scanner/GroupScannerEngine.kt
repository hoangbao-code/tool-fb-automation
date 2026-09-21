package com.example.posthub.scanner

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.dao.GroupDao
import com.example.posthub.data.local.entity.GroupEntity
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

data class ScannerState(
    val platform: String = "fb",
    val isScanning: Boolean = false,
    val progressCount: Int = 0,
    val statusMessage: String = "",
    val error: String? = null,
    val brokenSelector: String? = null,
    val isCheckpoint: Boolean = false,
    val needsLogin: Boolean = false
)

class GroupScannerEngine(
    private val context: Context,
    private val groupDao: GroupDao,
    private val config: FullScannerConfig = FullScannerConfig.loadFromAssets(context)
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scanMutex = Mutex()

    private val _state = MutableStateFlow(ScannerState())
    val state = _state.asStateFlow()

    private var activeWebView: WebView? = null
    val jsBridge = ScannerJsBridge()

    private var scanJob: Job? = null

    init {
        CoroutineScope(Dispatchers.IO).launch {
            jsBridge.events.collect { event ->
                when (event) {
                    is ScannerJsBridge.ScanEvent.OnBatchExtracted -> {
                        processExtractedGroups(event.itemsJson)
                    }
                    is ScannerJsBridge.ScanEvent.OnProgress -> {
                        _state.value = _state.value.copy(
                            progressCount = event.count,
                            statusMessage = if (event.isDone) "Đã quét xong ${event.count} nhóm!" else "Đang quét: ${event.count} nhóm..."
                        )
                        if (event.isDone) {
                            _state.value = _state.value.copy(isScanning = false)
                        }
                    }
                    is ScannerJsBridge.ScanEvent.OnCheckpointDetected -> {
                        _state.value = _state.value.copy(
                            isScanning = false,
                            isCheckpoint = true,
                            error = event.reason,
                            statusMessage = "Tạm dừng: Yêu cầu xác minh bảo mật!"
                        )
                    }
                    is ScannerJsBridge.ScanEvent.OnSelectorFailure -> {
                        _state.value = _state.value.copy(
                            brokenSelector = event.selectorKey,
                            statusMessage = "Cảnh báo: Bộ chọn [${event.selectorKey}] không tìm thấy."
                        )
                    }
                    is ScannerJsBridge.ScanEvent.OnLog -> {
                        // Log nội bộ an toàn
                    }
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun prepareWebView(platform: String): WebView {
        val wv = WebView(context.applicationContext)
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(wv, true)

        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_DEFAULT

            userAgentString = if (platform == "zalo") {
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            } else {
                "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
            }
        }

        wv.addJavascriptInterface(jsBridge, "AndroidBridge")
        activeWebView = wv
        return wv
    }

    fun startScan(platform: String, enrichDetails: Boolean = false) {
        scanJob?.cancel()
        scanJob = CoroutineScope(Dispatchers.IO).launch {
            scanMutex.withLock {
                _state.value = ScannerState(
                    platform = platform,
                    isScanning = true,
                    statusMessage = "Đang chuẩn bị quét nhóm $platform..."
                )

                try {
                    if (platform == "fb") {
                        scanFacebook(enrichDetails)
                    } else {
                        scanZalo()
                    }
                } catch (e: CancellationException) {
                    _state.value = _state.value.copy(isScanning = false, statusMessage = "Đã dừng quét.")
                } catch (e: Exception) {
                    _state.value = _state.value.copy(
                        isScanning = false,
                        error = e.localizedMessage ?: "Lỗi không xác định khi quét."
                    )
                }
            }
        }
    }

    fun stopScan() {
        scanJob?.cancel()
        _state.value = _state.value.copy(isScanning = false, statusMessage = "Đã dừng quét.")
    }

    private suspend fun scanFacebook(enrichDetails: Boolean) {
        val targetUrl = config.facebook.primaryUrl
        AppLog.i("GroupScannerEngine", "Mở trang danh sách nhóm FB: $targetUrl")

        withContext(Dispatchers.Main) {
            val wv = activeWebView ?: prepareWebView("fb")
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    CoroutineScope(Dispatchers.IO).launch {
                        delay(2000) // Đợi DOM ổn định
                        injectFacebookScript(wv)
                    }
                }
            }
            wv.loadURL(targetUrl)
        }
    }

    private suspend fun scanZalo() {
        val targetUrl = config.zalo.url
        AppLog.i("GroupScannerEngine", "Mở Zalo Web: $targetUrl")

        withContext(Dispatchers.Main) {
            val wv = activeWebView ?: prepareWebView("zalo")
            wv.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    CoroutineScope(Dispatchers.IO).launch {
                        delay(2500)
                        injectZaloScript(wv)
                    }
                }
            }
            wv.loadURL(targetUrl)
        }
    }

    private fun injectFacebookScript(wv: WebView) {
        val configJson = JSONObject().apply {
            put("primaryUrl", config.facebook.primaryUrl)
            put("fallbackUrl", config.facebook.fallbackUrl)
            put("groupItemLinkSelector", config.facebook.groupItemLinkSelector)
            put("checkpointIndicatorSelectors", JSONArray(config.facebook.checkpointIndicatorSelectors))
            put("excludedPathIds", JSONArray(config.facebook.excludedPathIds))
            put("minDelayMs", config.safety.minDelayMs)
            put("maxDelayMs", config.safety.maxDelayMs)
            put("maxFbGroups", config.safety.maxFbGroups)
            put("maxConsecutiveStallCount", config.safety.maxConsecutiveStallCount)
        }.toString()

        val jsCode = """
            (async function(cfg) {
                function notify(type, data) {
                    if (window.AndroidBridge) {
                        window.AndroidBridge.postMessage(JSON.stringify(Object.assign({ type: type }, data)));
                    }
                }

                // 1. Kiểm tra checkpoint
                for (var sel of cfg.checkpointIndicatorSelectors) {
                    if (document.querySelector(sel)) {
                        notify('CHECKPOINT', { reason: 'Phát hiện trang bảo vệ hoặc checkpoint Facebook.' });
                        return;
                    }
                }

                var foundMap = {};
                var excluded = cfg.excludedPathIds || [];

                function harvest() {
                    var links = document.querySelectorAll(cfg.groupItemLinkSelector);
                    if (!links || links.length === 0) {
                        notify('SELECTOR_ERROR', { selector: cfg.groupItemLinkSelector, error: 'Không tìm thấy thẻ liên kết nhóm' });
                        return;
                    }

                    links.forEach(function(a) {
                        var href = a.getAttribute('href') || '';
                        var match = href.match(/\/groups\/([^\/?#]+)/);
                        if (!match) return;

                        var gId = match[1];
                        if (excluded.indexOf(gId) !== -1) return;

                        var rawText = (a.innerText || a.getAttribute('aria-label') || '').trim();
                        var lines = rawText.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
                        var name = lines[0] || ('Nhóm Facebook ' + gId);

                        var members = '';
                        for (var i = 0; i < lines.length; i++) {
                            if (lines[i].indexOf('thành viên') !== -1 || lines[i].toLowerCase().indexOf('member') !== -1) {
                                members = lines[i];
                                break;
                            }
                        }

                        if (!foundMap[gId]) {
                            foundMap[gId] = { externalId: gId, name: name, memberCount: members };
                        }
                    });
                }

                // 2. Vòng lặp cuộn tự động
                var stallCount = 0;
                var lastCount = 0;
                var maxG = cfg.maxFbGroups || 300;

                while (Object.keys(foundMap).length < maxG && stallCount < cfg.maxConsecutiveStallCount) {
                    harvest();
                    var curCount = Object.keys(foundMap).length;
                    notify('PROGRESS', { count: curCount, isDone: false });

                    if (curCount === lastCount) {
                        stallCount++;
                    } else {
                        stallCount = 0;
                        lastCount = curCount;
                    }

                    window.scrollBy(0, window.innerHeight * 1.5);
                    var delayTime = Math.floor(Math.random() * (cfg.maxDelayMs - cfg.minDelayMs + 1)) + cfg.minDelayMs;
                    await new Promise(function(r) { setTimeout(r, delayTime); });
                }

                var results = Object.values(foundMap);
                notify('BATCH_ITEMS', { payload: JSON.stringify(results) });
                notify('PROGRESS', { count: results.length, isDone: true });
            })($configJson);
        """.trimIndent()

        mainHandler.post {
            wv.evaluateJavascript(jsCode, null)
        }
    }

    private fun injectZaloScript(wv: WebView) {
        val configJson = JSONObject().apply {
            put("url", config.zalo.url)
            put("qrLoginSelector", config.zalo.qrLoginSelector)
            put("virtualListSelector", config.zalo.virtualListSelector)
            put("chatItemSelector", config.zalo.chatItemSelector)
            put("titleSelector", config.zalo.titleSelector)
            put("lastMsgTimeSelector", config.zalo.lastMsgTimeSelector)
            put("groupAvatarSelector", config.zalo.groupAvatarSelector)
            put("contactsTabSelector", config.zalo.contactsTabSelector)
            put("groupSubTabSelector", config.zalo.groupSubTabSelector)
            put("groupListItemSelector", config.zalo.groupListItemSelector)
        }.toString()

        val jsCode = """
            (async function(cfg) {
                function notify(type, data) {
                    if (window.AndroidBridge) {
                        window.AndroidBridge.postMessage(JSON.stringify(Object.assign({ type: type }, data)));
                    }
                }

                if (document.querySelector(cfg.qrLoginSelector)) {
                    notify('CHECKPOINT', { reason: 'Chưa đăng nhập Zalo. Hãy quét mã QR trước khi đồng bộ.' });
                    return;
                }

                var groupMap = {};
                function addGroup(name, members, lastMsg) {
                    if (!name) return;
                    var clean = name.trim();
                    var lower = clean.toLowerCase();
                    if (lower === 'zalo' || lower === 'cloud của tôi' || lower === 'truyền file') return;
                    if (!groupMap[lower]) {
                        var hash = Math.abs(clean.split('').reduce(function(a,b){a=((a<<5)-a)+b.charCodeAt(0);return a&a},0));
                        groupMap[lower] = {
                            externalId: 'zalo_' + hash,
                            name: clean,
                            memberCount: members || '',
                            lastMsgTime: lastMsg || ''
                        };
                    }
                }

                // Quét Virtual List trên danh sách hội thoại
                var vList = document.querySelector(cfg.virtualListSelector);
                if (vList) {
                    vList.scrollTop = 0;
                    for (var s = 0; s < 25; s++) {
                        var items = vList.querySelectorAll(cfg.chatItemSelector);
                        items.forEach(function(el) {
                            var titleEl = el.querySelector(cfg.titleSelector);
                            var isGroup = el.querySelector(cfg.groupAvatarSelector) !== null || (el.getAttribute('data-id') || '').indexOf('g') === 0;
                            if (titleEl && isGroup) {
                                var timeEl = el.querySelector(cfg.lastMsgTimeSelector);
                                addGroup(titleEl.innerText, '', timeEl ? timeEl.innerText : '');
                            }
                        });
                        vList.scrollTop += 350;
                        notify('PROGRESS', { count: Object.keys(groupMap).length, isDone: false });
                        await new Promise(function(r) { setTimeout(r, 200); });
                    }
                }

                // Quét Danh Bạ -> Danh Sách Nhóm để gom 100% nhóm
                var contactTab = document.querySelector(cfg.contactsTabSelector);
                if (contactTab) {
                    contactTab.click();
                    await new Promise(function(r) { setTimeout(r, 600); });

                    var groupSub = document.querySelector(cfg.groupSubTabSelector);
                    if (groupSub) {
                        groupSub.click();
                        await new Promise(function(r) { setTimeout(r, 600); });

                        for (var gs = 0; gs < 30; gs++) {
                            document.querySelectorAll(cfg.groupListItemSelector).forEach(function(el) {
                                var nameEl = el.querySelector('.group-item__name, .contact-item__name, [class*="name"]');
                                if (nameEl) addGroup(nameEl.innerText, '', '');
                            });
                            window.scrollBy(0, 450);
                            await new Promise(function(r) { setTimeout(r, 200); });
                        }
                    }
                }

                var results = Object.values(groupMap);
                notify('BATCH_ITEMS', { payload: JSON.stringify(results) });
                notify('PROGRESS', { count: results.length, isDone: true });
            })($configJson);
        """.trimIndent()

        mainHandler.post {
            wv.evaluateJavascript(jsCode, null)
        }
    }

    private suspend fun processExtractedGroups(jsonString: String) {
        withContext(Dispatchers.IO) {
            try {
                val array = JSONArray(jsonString)
                val platform = _state.value.platform
                val entities = mutableListOf<GroupEntity>()

                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    val extId = obj.getString("externalId")
                    val name = obj.getString("name")
                    val members = obj.optString("memberCount", "")

                    entities.add(
                        GroupEntity(
                            platform = platform,
                            externalId = extId,
                            name = name,
                            memberCount = members.ifBlank { null },
                            category = SuggestionHelper.suggestCategory(name),
                            area = SuggestionHelper.suggestArea(name),
                            lastSynced = System.currentTimeMillis()
                        )
                    )
                }

                groupDao.syncGroupsUpsert(platform, entities)
                AppLog.i("GroupScannerEngine", "Đã lưu thành công ${entities.size} nhóm $platform vào Room Database.")
            } catch (e: Exception) {
                AppLog.e("GroupScannerEngine", "Lỗi nạp danh sách nhóm: ${e.message}")
            }
        }
    }
}
