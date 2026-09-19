package com.example.posthub.fb

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.SecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCancellableCoroutine

class FbWebSession(
    private val context: Context,
    private val secureStore: SecureStore,
    private var selectorConfig: SelectorConfig = SelectorConfig.DEFAULT
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private val isInitializing = AtomicBoolean(false)

    /**
     * Gắn WebView từ giao diện hoặc khởi tạo ngầm
     */
    fun attachWebView(view: WebView) {
        this.webView = view
        setupWebViewSettings(view)
        restoreCookies()
        AppLog.i("FbWebSession", "Đã gắn kết WebView với phiên Facebook thành công.")
    }

    private fun setupWebViewSettings(view: WebView) {
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            userAgentString = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        }

        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView?, url: String?) {
                super.onPageFinished(v, url)
                saveCookies()
                checkForCheckpoint(v)
            }

            override fun shouldOverrideUrlLoading(v: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }
        }
    }

    fun restoreCookies() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        val saved = secureStore.getFbCookies()
        if (saved.isNotBlank()) {
            val parts = saved.split(";")
            for (part in parts) {
                val clean = part.trim()
                if (clean.isNotEmpty()) {
                    cookieManager.setCookie("https://m.facebook.com", clean)
                }
            }
            cookieManager.flush()
            AppLog.i("FbWebSession", "Đã khôi phục cookie phiên Facebook từ SecureStore.")
        }
    }

    fun saveCookies() {
        val cookieManager = CookieManager.getInstance()
        val cookies = cookieManager.getCookie("https://m.facebook.com")
        if (!cookies.isNullOrBlank()) {
            secureStore.saveFbCookies(cookies)
            if (cookies.contains("c_user=")) {
                val cUser = cookies.substringAfter("c_user=").substringBefore(";")
                secureStore.saveFbAccountName("Facebook UID: $cUser")
            }
        }
    }

    /**
     * Kiểm tra người dùng đã đăng nhập chưa dựa vào cookie c_user
     */
    fun isLoggedIn(): Boolean {
        val cookies = CookieManager.getInstance().getCookie("https://m.facebook.com") ?: secureStore.getFbCookies()
        return cookies.contains("c_user=")
    }

    /**
     * Mở trang đăng nhập Facebook di động
     */
    fun openLoginPage() {
        mainHandler.post {
            webView?.loadUrl("https://m.facebook.com/login")
        }
    }

    /**
     * Mở một nhóm Facebook
     */
    fun openGroup(groupUrl: String) {
        val target = if (groupUrl.startsWith("http")) groupUrl else "https://m.facebook.com/$groupUrl"
        mainHandler.post {
            webView?.loadUrl(target)
        }
    }

    /**
     * Tự động quét phát hiện Checkpoint/Captcha/Bị hạn chế
     */
    private fun checkForCheckpoint(v: WebView?) {
        v?.evaluateJavascript("document.body.innerText") { text ->
            if (text != null) {
                val lower = text.lowercase()
                for (sig in selectorConfig.checkpointSignatures) {
                    if (lower.contains(sig.lowercase())) {
                        secureStore.setEmergencyStop(true)
                        AppLog.e("FbWebSession", "PHÁT HIỆN DẤU HIỆU CHECKPOINT / HẠN CHẾ FACEBOOK: '$sig'! Đã kích hoạt Dừng Khẩn Cấp ngay lập tức.")
                        break
                    }
                }
            }
        }
    }

    /**
     * Thực thi đăng bài lên Group:
     * - isAssisted = true: Mở ô soạn thảo, điền sẵn nội dung, để người dùng tự bấm nút Đăng cuối cùng.
     * - isAssisted = false: Tự động điền và bấm Đăng sau khi qua rào chắn Jitter.
     */
    suspend fun postToGroup(
        groupUrl: String,
        content: String,
        isAssisted: Boolean = true
    ): Result<String> = withContext(Dispatchers.Main) {
        if (secureStore.isEmergencyStop()) {
            return@withContext Result.failure(IllegalStateException("Đang trong trạng thái DỪNG KHẨN CẤP! Vui lòng kiểm tra lại tài khoản."))
        }

        if (secureStore.isDryRun()) {
            AppLog.i("FbWebSession", "[DRY-RUN] Giả lập đăng bài thành công vào: $groupUrl (Nội dung: ${content.take(50)}...)")
            return@withContext Result.success("DRY-RUN thành công")
        }

        val wv = webView ?: return@withContext Result.failure(IllegalStateException("WebView chưa được khởi tạo."))

        // 1. Mở nhóm
        openGroup(groupUrl)
        delay(JitterPolicy.calculateActionDelayMillis(4, 7))

        // 2. Mở trình soạn thảo bài viết bằng Javascript
        val clickComposerJs = """
            (function() {
                var btn = document.querySelector("${selectorConfig.composerOpenButton}");
                if (btn) { btn.click(); return 'OPENED'; }
                return 'NOT_FOUND';
            })();
        """.trimIndent()

        val openStatus = evaluateJs(wv, clickComposerJs)
        AppLog.i("FbWebSession", "Mở khung soạn thảo bài viết: $openStatus")
        delay(JitterPolicy.calculateActionDelayMillis(3, 5))

        // 3. Điền nội dung bài viết
        val escapedContent = content.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
        val fillTextJs = """
            (function() {
                var el = document.querySelector("${selectorConfig.composerTextArea}");
                if (el) {
                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                        el.value = `$escapedContent`;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        el.innerText = `$escapedContent`;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    return 'FILLED';
                }
                return 'TEXTAREA_NOT_FOUND';
            })();
        """.trimIndent()

        val fillStatus = evaluateJs(wv, fillTextJs)
        AppLog.i("FbWebSession", "Điền nội dung bài viết: $fillStatus")

        if (isAssisted) {
            AppLog.i("FbWebSession", "Chế độ TRỢ LỰC (ASSISTED): Đã điền sẵn bài viết và chuẩn bị ảnh. Mời bạn kiểm tra lại trên màn hình và tự bấm 'Đăng'!")
            return@withContext Result.success("Đã chuẩn bị xong bài viết (Chế độ Trợ lực)")
        } else {
            // Chế độ AUTO: Đợi giãn cách Jitter rồi tự bấm nút đăng
            val delayBeforeSubmit = JitterPolicy.calculateActionDelayMillis(5, 10)
            AppLog.i("FbWebSession", "Chế độ TỰ ĐỘNG (AUTO): Chờ ${delayBeforeSubmit / 1000}s giãn cách an toàn trước khi bấm Đăng...")
            delay(delayBeforeSubmit)

            val clickSubmitJs = """
                (function() {
                    var submitBtn = document.querySelector("${selectorConfig.composerSubmitButton}");
                    if (submitBtn) {
                        submitBtn.click();
                        return 'SUBMITTED';
                    }
                    return 'SUBMIT_BTN_NOT_FOUND';
                })();
            """.trimIndent()

            val submitStatus = evaluateJs(wv, clickSubmitJs)
            AppLog.i("FbWebSession", "Bấm nút đăng tự động: $submitStatus")
            return@withContext Result.success("Đã hoàn tất lệnh đăng tự động")
        }
    }

    private suspend fun evaluateJs(wv: WebView, script: String): String = suspendCancellableCoroutine { continuation ->
        wv.evaluateJavascript(script) { result ->
            val cleanResult = result?.trim('"') ?: ""
            continuation.resume(cleanResult)
        }
    }

    fun updateSelectorConfig(newConfig: SelectorConfig) {
        this.selectorConfig = newConfig
        AppLog.i("FbWebSession", "Đã cập nhật SelectorConfig phiên bản: ${newConfig.version}")
    }
}
