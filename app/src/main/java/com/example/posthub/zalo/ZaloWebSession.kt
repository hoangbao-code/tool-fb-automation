package com.example.posthub.zalo

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.SecureStore
import com.example.posthub.domain.model.PostSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class ZaloWebSession(
    private val context: Context,
    private val secureStore: SecureStore
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null

    private val _scannedGroups = MutableStateFlow<List<DetectedZaloGroup>>(emptyList())
    val scannedGroups = _scannedGroups.asStateFlow()

    private val _isScanning = MutableStateFlow(false)
    val isScanning = _isScanning.asStateFlow()

    val jsBridge = ZaloJsBridge(
        onMessageCaptured = { groupName, senderName, text ->
            // Kiểm tra xem nhóm này có nằm trong danh sách được người dùng chọn theo dõi hay không
            if (secureStore.isGroupMonitored(groupName)) {
                AppLog.i("ZaloWebSession", "Nhóm [$groupName] nằm trong danh sách theo dõi -> Đưa vào hàng chờ gộp tin.")
                JammyApp.instance.container.messageMerger.addMessage(
                    senderOrGroup = groupName,
                    text = text,
                    photoPaths = emptyList(),
                    source = PostSource.ZALO_WEB
                )
            } else {
                AppLog.d("ZaloWebSession", "Bỏ qua tin nhắn từ nhóm [$groupName] vì chưa được chọn theo dõi.")
            }
        },
        onGroupsScanned = { groups ->
            _scannedGroups.value = groups
            _isScanning.value = false
        }
    )

    fun getOrCreateWebView(ctx: Context = context): WebView {
        if (webView == null) {
            val wv = WebView(ctx.applicationContext)
            attachWebView(wv)
        }
        return webView!!
    }

    fun attachWebView(view: WebView) {
        this.webView = view
        setupWebView(view)
        AppLog.i("ZaloWebSession", "Đã gắn kết WebView với phiên Zalo Web thành công.")
    }

    private fun setupWebView(view: WebView) {
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportMultipleWindows(true)
            allowFileAccess = true
            // BẮT BUỘC dùng Desktop User Agent để Zalo Web không chặn trên điện thoại
            userAgentString = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(view, true)

        // Tự động nạp Session Token (zpw_sek) cài sẵn vào WebView
        val sek = secureStore.getZaloCustomSek()
        if (sek.isNotBlank()) {
            cookieManager.setCookie("https://chat.zalo.me", "zpw_sek=$sek; Domain=.zalo.me; Path=/; Secure")
            cookieManager.setCookie("https://chat.zalo.me", "_zlang=vn; Domain=.zalo.me; Path=/; Secure")
            cookieManager.flush()
            AppLog.i("ZaloWebSession", "Đã nạp sẵn zpw_sek vào CookieManager trước khi tải trang.")
        }

        view.addJavascriptInterface(jsBridge, "JammyZaloBridge")

        view.webChromeClient = object : WebChromeClient() {}

        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView?, url: String?) {
                super.onPageFinished(v, url)
                cookieManager.flush()
                AppLog.i("ZaloWebSession", "Zalo Web tải trang hoàn tất: $url")

                val currentSek = secureStore.getZaloCustomSek()
                if (currentSek.isNotBlank()) {
                    val sekSafe = currentSek.replace("'", "\\'")
                    v?.evaluateJavascript("""
                        (function() {
                            try {
                                if (!localStorage.getItem('zpw_sek')) {
                                    localStorage.setItem('zpw_sek', '$sekSafe');
                                }
                            } catch(e) {}
                        })();
                    """.trimIndent(), null)
                }

                injectZaloMonitor(v)
            }

            override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }
        }

        // Tải trang Zalo Web
        view.loadUrl("https://chat.zalo.me")
    }

    /**
     * Nạp nhanh mã zpw_sek mới và tải lại phiên Zalo Web
     */
    fun applyCustomSek(sek: String) {
        secureStore.setZaloCustomSek(sek)
        val cm = CookieManager.getInstance()
        cm.setCookie("https://chat.zalo.me", "zpw_sek=$sek; Domain=.zalo.me; Path=/; Secure")
        cm.setCookie("https://chat.zalo.me", "_zlang=vn; Domain=.zalo.me; Path=/; Secure")
        cm.flush()
        val sekSafe = sek.replace("'", "\\'")
        webView?.evaluateJavascript("""
            (function() {
                try {
                    localStorage.setItem('zpw_sek', '$sekSafe');
                } catch(e) {}
            })();
        """.trimIndent(), null)
        webView?.loadUrl("https://chat.zalo.me")
    }

    /**
     * Tiêm kịch bản JS để bắt hội thoại đang mở và tin nhắn mới trong Zalo Web
     */
    fun injectZaloMonitor(v: WebView?) {
        val script = """
            (function() {
                if (window.__jammyZaloInjected) return;
                window.__jammyZaloInjected = true;
                
                function getActiveChatTitle() {
                    // Tìm tiêu đề hội thoại đang mở ở header
                    var titleEl = document.querySelector('.header-title, .chat-title, .header__title, div[data-id="header-title"], .chat-box__header .title, .truncate');
                    if (titleEl && titleEl.innerText) {
                        return titleEl.innerText.trim();
                    }
                    return '';
                }

                var currentTitle = '';
                setInterval(function() {
                    var newTitle = getActiveChatTitle();
                    if (newTitle && newTitle !== currentTitle) {
                        currentTitle = newTitle;
                        if (window.JammyZaloBridge) {
                            window.JammyZaloBridge.onActiveConversationChanged(currentTitle, '');
                        }
                    }
                }, 1500);

                // Quan sát tin nhắn mới xuất hiện trong DOM
                var observer = new MutationObserver(function(mutations) {
                    var activeGroup = getActiveChatTitle();
                    for (var i = 0; i < mutations.length; i++) {
                        var mutation = mutations[i];
                        for (var j = 0; j < mutation.addedNodes.length; j++) {
                            var node = mutation.addedNodes[j];
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Tìm các phần tử tin nhắn
                                var msgContainers = [];
                                if (node.matches && (node.matches('.chat-message, .msg-info, .card-content, [data-id*="msg"]'))) {
                                    msgContainers.push(node);
                                }
                                if (node.querySelectorAll) {
                                    var children = node.querySelectorAll('.chat-message, .msg-info, .card-content, [data-id*="msg"]');
                                    for (var k = 0; k < children.length; k++) {
                                        msgContainers.push(children[k]);
                                    }
                                }

                                for (var m = 0; m < msgContainers.length; m++) {
                                    var container = msgContainers[m];
                                    var textEl = container.querySelector('.text, .content, .bubble-content, .msg-text') || container;
                                    var text = textEl ? textEl.innerText : '';
                                    
                                    // Loại bỏ tin rác / thời gian / thông báo
                                    if (text && text.trim().length > 3) {
                                        var senderEl = container.querySelector('.sender-name, .author, .msg-sender, .sender');
                                        var sender = senderEl ? senderEl.innerText.trim() : '';
                                        
                                        if (window.JammyZaloBridge) {
                                            window.JammyZaloBridge.onNewMessage(activeGroup, sender, text.trim(), Date.now());
                                        }
                                    }
                                }
                            }
                        }
                    }
                });

                observer.observe(document.body, { childList: true, subtree: true });
                if (window.JammyZaloBridge) {
                    window.JammyZaloBridge.log('ZaloMonitor', 'Đã khởi chạy bộ giám sát DOM Zalo Web.');
                }
            })();
        """.trimIndent()

        mainHandler.post {
            v?.evaluateJavascript(script, null)
        }
    }

    /**
     * Kích hoạt quét danh sách tất cả hội thoại/nhóm hiển thị trên thanh bên trái Zalo Web
     */
    fun scanGroups() {
        val wv = webView ?: return
        _isScanning.value = true

        val script = """
            (function() {
                var groups = [];
                var seen = {};
                // Tìm các phần tử hội thoại ở sidebar
                var items = document.querySelectorAll('.conv-item, [id^="conv_"], .chat-item, div[tabindex="0"]');
                for (var i = 0; i < items.length; i++) {
                    var el = items[i];
                    var titleEl = el.querySelector('.conv-item-title__name, .name, .title, .truncate, div[title]');
                    var name = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText) : '';
                    if (!name && el.getAttribute('title')) {
                        name = el.getAttribute('title');
                    }
                    if (name && name.trim().length > 1) {
                        name = name.trim();
                        if (!seen[name]) {
                            seen[name] = true;
                            groups.push({
                                name: name,
                                id: el.getAttribute('data-id') || '',
                                avatar: ''
                            });
                        }
                    }
                }
                if (window.JammyZaloBridge) {
                    window.JammyZaloBridge.onDiscoveredGroups(JSON.stringify(groups));
                }
            })();
        """.trimIndent()

        mainHandler.post {
            wv.evaluateJavascript(script, null)
        }
    }
}
