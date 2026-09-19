package com.example.posthub.fb

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.SecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

data class DiscoveredGroup(
    val name: String,
    val url: String,
    val memberInfo: String = "",
    val isJoined: Boolean = false
)

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
     * Tự động quét toàn bộ nhóm người dùng ĐÃ THAM GIA trên Facebook
     */
    suspend fun scanJoinedGroups(): Result<List<DiscoveredGroup>> = withContext(Dispatchers.Main) {
        if (!isLoggedIn()) {
            return@withContext Result.failure(IllegalStateException("Bạn chưa đăng nhập Facebook. Vui lòng vào tab Facebook để đăng nhập."))
        }

        val wv = webView ?: return@withContext Result.failure(IllegalStateException("WebView chưa được khởi tạo."))

        AppLog.i("FbWebSession", "Bắt đầu quét danh sách nhóm đã tham gia từ https://m.facebook.com/groups/joins/...")
        wv.loadUrl("https://m.facebook.com/groups/joins/")
        delay(JitterPolicy.calculateActionDelayMillis(4, 7))

        val scanScript = """
            (function() {
                var list = [];
                var seen = {};
                var anchors = document.querySelectorAll("a[href*='/groups/']");
                for (var i = 0; i < anchors.length; i++) {
                    var a = anchors[i];
                    var href = a.href || "";
                    var m = href.match(/facebook\.com\/groups\/([^\/?#]+)/i);
                    if (m && m[1]) {
                        var id = m[1];
                        if (id !== 'create' && id !== 'discover' && id !== 'feed' && id !== 'joins' && id !== 'category') {
                            var cleanUrl = "https://m.facebook.com/groups/" + id;
                            if (!seen[cleanUrl]) {
                                seen[cleanUrl] = true;
                                var text = (a.innerText || a.textContent || "").trim();
                                if (text.length > 1 && text.indexOf('\n') === -1) {
                                    list.push({ name: text, url: cleanUrl, isJoined: true });
                                } else if (text.length > 1) {
                                    var firstLine = text.split('\n')[0].trim();
                                    list.push({ name: firstLine, url: cleanUrl, isJoined: true });
                                }
                            }
                        }
                    }
                }
                return JSON.stringify(list);
            })();
        """.trimIndent()

        val jsonResult = evaluateJs(wv, scanScript)
        val discoveredList = mutableListOf<DiscoveredGroup>()

        try {
            val jsonArray = JSONArray(jsonResult)
            for (i in 0 until jsonArray.length()) {
                val item = jsonArray.getJSONObject(i)
                discoveredList.add(
                    DiscoveredGroup(
                        name = item.optString("name", "Nhóm Facebook"),
                        url = item.optString("url"),
                        isJoined = true
                    )
                )
            }
            AppLog.i("FbWebSession", "Quét thành công! Tìm thấy ${discoveredList.size} nhóm đã tham gia.")
            Result.success(discoveredList)
        } catch (e: Exception) {
            AppLog.e("FbWebSession", "Lỗi phân tích JSON kết quả quét nhóm", e)
            Result.failure(e)
        }
    }

    /**
     * Tìm kiếm nhóm theo từ khóa trên Facebook Mobile Web
     */
    suspend fun searchGroupsByKeyword(keyword: String): Result<List<DiscoveredGroup>> = withContext(Dispatchers.Main) {
        if (!isLoggedIn()) {
            return@withContext Result.failure(IllegalStateException("Bạn chưa đăng nhập Facebook."))
        }

        val wv = webView ?: return@withContext Result.failure(IllegalStateException("WebView chưa được khởi tạo."))

        val encodedQuery = URLEncoder.encode(keyword.trim(), "UTF-8")
        val searchUrl = "https://m.facebook.com/search/groups/?q=$encodedQuery"
        AppLog.i("FbWebSession", "Tìm kiếm nhóm theo từ khóa: '$keyword' ($searchUrl)")
        wv.loadUrl(searchUrl)
        delay(JitterPolicy.calculateActionDelayMillis(4, 7))

        val parseScript = """
            (function() {
                var list = [];
                var seen = {};
                var anchors = document.querySelectorAll("a[href*='/groups/']");
                for (var i = 0; i < anchors.length; i++) {
                    var a = anchors[i];
                    var href = a.href || "";
                    var m = href.match(/facebook\.com\/groups\/([^\/?#]+)/i);
                    if (m && m[1]) {
                        var id = m[1];
                        if (id !== 'create' && id !== 'discover' && id !== 'feed') {
                            var cleanUrl = "https://m.facebook.com/groups/" + id;
                            if (!seen[cleanUrl]) {
                                seen[cleanUrl] = true;
                                var name = (a.innerText || a.textContent || "").trim();
                                if (name.length > 2) {
                                    var parent = a.closest("div[role='article']") || a.parentElement?.parentElement || a.parentElement;
                                    var parentText = (parent ? parent.innerText : "").toLowerCase();
                                    var isJoined = parentText.indexOf("đã tham gia") !== -1 || parentText.indexOf("joined") !== -1;
                                    list.push({
                                        name: name.split('\n')[0].trim(),
                                        url: cleanUrl,
                                        isJoined: isJoined
                                    });
                                }
                            }
                        }
                    }
                }
                return JSON.stringify(list);
            })();
        """.trimIndent()

        val jsonResult = evaluateJs(wv, parseScript)
        val discoveredList = mutableListOf<DiscoveredGroup>()

        try {
            val jsonArray = JSONArray(jsonResult)
            for (i in 0 until jsonArray.length()) {
                val item = jsonArray.getJSONObject(i)
                discoveredList.add(
                    DiscoveredGroup(
                        name = item.optString("name", "Nhóm Facebook"),
                        url = item.optString("url"),
                        isJoined = item.optBoolean("isJoined", false)
                    )
                )
            }
            AppLog.i("FbWebSession", "Tìm kiếm hoàn tất! Tìm thấy ${discoveredList.size} nhóm phù hợp với từ khóa '$keyword'.")
            Result.success(discoveredList)
        } catch (e: Exception) {
            AppLog.e("FbWebSession", "Lỗi phân tích kết quả tìm kiếm nhóm", e)
            Result.failure(e)
        }
    }

    /**
     * Tự động gửi yêu cầu tham gia nhóm kèm tự động điền câu hỏi xét duyệt (Auto-Join)
     */
    suspend fun joinGroupWithAnswers(
        groupUrl: String,
        answers: List<String>
    ): Result<String> = withContext(Dispatchers.Main) {
        if (secureStore.isEmergencyStop()) {
            return@withContext Result.failure(IllegalStateException("Đang trong trạng thái DỪNG KHẨN CẤP!"))
        }

        val wv = webView ?: return@withContext Result.failure(IllegalStateException("WebView chưa được khởi tạo."))

        AppLog.i("FbWebSession", "Bắt đầu quy trình tham gia nhóm: $groupUrl")
        openGroup(groupUrl)
        delay(JitterPolicy.calculateActionDelayMillis(4, 7))

        // 1. Tìm và bấm nút Tham gia nhóm
        val clickJoinJs = """
            (function() {
                var btn = document.querySelector("${selectorConfig.groupJoinButton}");
                if (btn) {
                    btn.click();
                    return 'CLICKED_JOIN';
                }
                return 'JOIN_BUTTON_NOT_FOUND';
            })();
        """.trimIndent()

        val joinClickStatus = evaluateJs(wv, clickJoinJs)
        AppLog.i("FbWebSession", "Trạng thái bấm nút tham gia: $joinClickStatus")
        delay(JitterPolicy.calculateActionDelayMillis(3, 5))

        // 2. Kiểm tra xem có xuất hiện form câu hỏi xét duyệt không
        val escapedAnswersJson = JSONArray(answers).toString().replace("`", "\\`").replace("$", "\\$")
        val answerQuestionsJs = """
            (function() {
                var answers = $escapedAnswersJson;
                var inputs = document.querySelectorAll("${selectorConfig.joinAnswerInput}");
                var filledCount = 0;

                for (var i = 0; i < inputs.length; i++) {
                    var el = inputs[i];
                    var ans = answers[i % answers.length] || "Tôi đồng ý nội quy nhóm.";
                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                        el.value = ans;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                }

                // Tick chọn tất cả các checkbox quy tắc nhóm
                var checkboxes = document.querySelectorAll("${selectorConfig.joinCheckbox}");
                for (var c = 0; c < checkboxes.length; c++) {
                    var cb = checkboxes[c];
                    if (cb.type === 'checkbox' && !cb.checked) {
                        cb.click();
                    } else if (cb.getAttribute('aria-checked') === 'false') {
                        cb.click();
                    }
                }

                // Bấm nút Gửi câu trả lời
                var submitBtn = document.querySelector("${selectorConfig.joinSubmitButton}");
                if (submitBtn) {
                    submitBtn.click();
                    return 'FILLED_AND_SUBMITTED_' + filledCount;
                }

                return filledCount > 0 ? 'FILLED_' + filledCount : 'NO_QUESTIONS';
            })();
        """.trimIndent()

        val answerStatus = evaluateJs(wv, answerQuestionsJs)
        AppLog.i("FbWebSession", "Kết quả điền câu hỏi xét duyệt: $answerStatus")

        Result.success("Yêu cầu tham gia nhóm đã được gửi thành công ($answerStatus)")
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
