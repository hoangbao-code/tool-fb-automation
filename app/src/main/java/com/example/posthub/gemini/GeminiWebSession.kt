package com.example.posthub.gemini

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.example.posthub.data.AppLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

class GeminiWebSession(
    private val context: Context
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null

    val jsBridge = GeminiJsBridge()

    private val _pendingPromptToSend = MutableStateFlow<String?>(null)
    val pendingPromptToSend = _pendingPromptToSend.asStateFlow()

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
        AppLog.i("GeminiWebSession", "Đã gắn kết WebView với phiên Gemini Web thành công.")
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
            // BẮT BUỘC dùng User-Agent Chrome chuẩn không có 'wv' hay 'Version/4.0' để Google cho phép đăng nhập
            userAgentString = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        }

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(view, true)

        view.addJavascriptInterface(jsBridge, "JammyGeminiBridge")

        view.webChromeClient = object : WebChromeClient() {}

        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView?, url: String?) {
                super.onPageFinished(v, url)
                cookieManager.flush()
                AppLog.i("GeminiWebSession", "Gemini Web tải trang hoàn tất: $url")
                injectGeminiHelper(v)

                // Nếu có tin nhắn đang chờ gửi sau khi trang tải xong
                val pending = _pendingPromptToSend.value
                if (pending != null) {
                    _pendingPromptToSend.value = null
                    sendPromptToWeb(pending)
                }
            }

            override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }
        }

        view.loadUrl("https://gemini.google.com/app")
    }

    private fun injectGeminiHelper(v: WebView?) {
        val script = """
            (function() {
                if (window.__jammyGeminiInjected) return;
                window.__jammyGeminiInjected = true;

                // Hàm quan sát trạng thái trả lời của Gemini
                var observer = new MutationObserver(function() {
                    var sendBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="Gửi"], button.send-button');
                    var isResponding = document.querySelector('.loading-dots, .streaming, [aria-busy="true"]') !== null;
                    if (window.JammyGeminiBridge) {
                        window.JammyGeminiBridge.onChatStateChanged(isResponding);
                    }
                });

                observer.observe(document.body, { childList: true, subtree: true });
                if (window.JammyGeminiBridge) {
                    window.JammyGeminiBridge.log('GeminiWeb', 'Đã khởi chạy bộ trợ giúp Gemini Web.');
                }
            })();
        """.trimIndent()

        mainHandler.post {
            v?.evaluateJavascript(script, null)
        }
    }

    /**
     * Tự động gửi Prompt + Nội dung vào khung chat của Gemini Web
     */
    fun sendPromptToWeb(fullPromptText: String) {
        // Tự động sao chép vào Clipboard làm phương án dự phòng
        try {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            val clip = ClipData.newPlainText("GeminiPrompt", fullPromptText)
            clipboard?.setPrimaryClip(clip)
        } catch (e: Exception) {
            AppLog.w("GeminiWebSession", "Không thể copy vào clipboard: ${e.message}")
        }

        val wv = webView
        if (wv == null) {
            _pendingPromptToSend.value = fullPromptText
            return
        }

        val escaped = JSONObject.quote(fullPromptText)
        val script = """
            (function() {
                var text = $escaped;
                // Tìm ô nhập liệu của Gemini Web
                var inputEl = document.querySelector('rich-textarea div[contenteditable="true"], div.ql-editor, div[contenteditable="true"], textarea');
                if (inputEl) {
                    inputEl.focus();
                    if (inputEl.tagName.toLowerCase() === 'textarea') {
                        inputEl.value = text;
                    } else {
                        inputEl.innerText = text;
                    }
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

                    // Đợi 300ms rồi bấm nút Gửi
                    setTimeout(function() {
                        var sendBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="Gửi"], button.send-button, .send-button-container button');
                        if (sendBtn && !sendBtn.disabled) {
                            sendBtn.click();
                            if (window.JammyGeminiBridge) {
                                window.JammyGeminiBridge.log('SendPrompt', 'Đã tự động bấm nút Gửi vào Gemini Web.');
                            }
                        } else {
                            if (window.JammyGeminiBridge) {
                                window.JammyGeminiBridge.log('SendPrompt', 'Đã điền nội dung vào ô chat, bạn có thể bấm nút Gửi.');
                            }
                        }
                    }, 400);
                } else {
                    if (window.JammyGeminiBridge) {
                        window.JammyGeminiBridge.log('SendPrompt', 'Không tìm thấy ô nhập liệu, đã sao chép vào bộ nhớ tạm.');
                    }
                }
            })();
        """.trimIndent()

        mainHandler.post {
            wv.evaluateJavascript(script, null)
        }
    }

    /**
     * Bóc tách câu trả lời mới nhất từ cuộc trò chuyện hiện tại trên Gemini Web
     */
    fun extractLatestResponse(onResult: (String) -> Unit = {}) {
        val wv = webView ?: return
        val script = """
            (function() {
                // Tìm tất cả khối câu trả lời của model
                var responses = document.querySelectorAll('.model-response-text, message-content, div[class*="response-container"], .markdown, model-response');
                if (responses && responses.length > 0) {
                    var last = responses[responses.length - 1];
                    var text = last.innerText ? last.innerText.trim() : '';
                    if (text && window.JammyGeminiBridge) {
                        window.JammyGeminiBridge.onResponseExtracted(text);
                        return text;
                    }
                }
                return '';
            })();
        """.trimIndent()

        mainHandler.post {
            wv.evaluateJavascript(script) { res ->
                val cleaned = res?.trim('"', ' ', '\\') ?: ""
                if (cleaned.isNotBlank()) {
                    onResult(cleaned)
                }
            }
        }
    }
}
