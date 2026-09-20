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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
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

data class AssistedPostingGroup(
    val id: Long,
    val name: String,
    val url: String
)

data class AssistedSession(
    val groups: List<AssistedPostingGroup>,
    val contentList: List<String>,
    var currentIndex: Int = 0
) {
    fun currentGroup(): AssistedPostingGroup? = groups.getOrNull(currentIndex)
    fun currentContent(): String = if (contentList.isNotEmpty()) contentList[currentIndex % contentList.size] else ""
    fun isLast(): Boolean = currentIndex >= groups.size - 1
    fun hasNext(): Boolean = currentIndex < groups.size - 1
    val progressDisplay: String get() = "${currentIndex + 1}/${groups.size}"
}

class FbWebSession(
    private val context: Context,
    private val secureStore: SecureStore,
    private var selectorConfig: SelectorConfig = SelectorConfig.DEFAULT
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private val isInitializing = AtomicBoolean(false)

    private val _assistedSession = MutableStateFlow<AssistedSession?>(null)
    val assistedSession = _assistedSession.asStateFlow()

    fun startAssistedSession(groups: List<AssistedPostingGroup>, contentList: List<String>) {
        if (groups.isEmpty()) return
        val session = AssistedSession(groups, contentList, 0)
        _assistedSession.value = session
        AppLog.i("FbWebSession", "Bắt đầu chuỗi đăng trợ lực cho ${groups.size} nhóm.")
        openGroup(groups.first().url)
    }

    fun nextAssistedGroup() {
        val session = _assistedSession.value ?: return
        if (session.hasNext()) {
            session.currentIndex++
            _assistedSession.value = session.copy(currentIndex = session.currentIndex)
            val next = session.currentGroup() ?: return
            AppLog.i("FbWebSession", "Chuyển sang nhóm trợ lực tiếp theo: [${next.name}] (${session.progressDisplay})")
            openGroup(next.url)
        } else {
            AppLog.i("FbWebSession", "Đã hoàn thành tất cả các nhóm trong phiên trợ lực.")
            _assistedSession.value = null
        }
    }

    fun cancelAssistedSession() {
        _assistedSession.value = null
        AppLog.i("FbWebSession", "Đã hủy phiên đăng trợ lực.")
    }

    /**
     * Lấy hoặc khởi tạo WebView bền bỉ trong toàn bộ vòng đời ứng dụng
     */
    fun getOrCreateWebView(ctx: Context = context): WebView {
        if (webView == null) {
            val wv = WebView(ctx.applicationContext)
            attachWebView(wv)
        }
        return webView!!
    }

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
                    cookieManager.setCookie("https://facebook.com", clean)
                    cookieManager.setCookie("https://m.facebook.com", clean)
                    cookieManager.setCookie("https://mbasic.facebook.com", clean)
                }
            }
            cookieManager.flush()
            AppLog.i("FbWebSession", "Đã khôi phục cookie phiên Facebook đa miền.")
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
        val wv = getOrCreateWebView(context)
        restoreCookies()

        if (!isLoggedIn()) {
            AppLog.w("FbWebSession", "Chưa phát hiện cookie đăng nhập Facebook (thiếu c_user).")
            return@withContext Result.failure(IllegalStateException("Bạn chưa đăng nhập Facebook. Vui lòng vào tab Facebook để đăng nhập trước."))
        }

        AppLog.i("FbWebSession", "Bắt đầu quét danh sách nhóm đã tham gia...")

        // Chiến lược 1: Thử truy cập https://www.facebook.com/groups/joins/ (URL chuẩn của nhóm đã tham gia trên Mobile)
        AppLog.i("FbWebSession", "[Chiến lược 1] Tải https://www.facebook.com/groups/joins/ ...")
        wv.loadUrl("https://www.facebook.com/groups/joins/")
        delay(4000)
        // Cuộn trang để ép React render các nhóm
        evaluateJs(wv, "window.scrollTo(0, 1000);")
        delay(2000)
        evaluateJs(wv, "window.scrollTo(0, 2500);")
        delay(1500)

        val discoveredList = extractGroupsFromCurrentPage(wv, isJoinedOnly = true).toMutableList()
        AppLog.i("FbWebSession", "[Chiến lược 1] Kết quả www.facebook.com/groups/joins/: tìm thấy ${discoveredList.size} nhóm.")

        // Chiến lược 2: Nếu chưa thấy, thử m.facebook.com/groups/joins/
        if (discoveredList.isEmpty()) {
            AppLog.i("FbWebSession", "[Chiến lược 2] Thử https://m.facebook.com/groups/joins/ ...")
            wv.loadUrl("https://m.facebook.com/groups/joins/")
            delay(4000)
            evaluateJs(wv, "window.scrollTo(0, 1500);")
            delay(2000)
            val joinsList = extractGroupsFromCurrentPage(wv, isJoinedOnly = true)
            discoveredList.addAll(joinsList)
            AppLog.i("FbWebSession", "[Chiến lược 2] Kết quả m.facebook.com/groups/joins/: tìm thấy ${joinsList.size} nhóm.")
        }

        // Chiến lược 3: Thử https://m.facebook.com/groups/?category=membership
        if (discoveredList.isEmpty()) {
            AppLog.i("FbWebSession", "[Chiến lược 3] Thử https://m.facebook.com/groups/?category=membership ...")
            wv.loadUrl("https://m.facebook.com/groups/?category=membership")
            delay(4000)
            evaluateJs(wv, "window.scrollTo(0, 1000);")
            delay(2000)
            val memberList = extractGroupsFromCurrentPage(wv, isJoinedOnly = true)
            discoveredList.addAll(memberList)
            AppLog.i("FbWebSession", "[Chiến lược 3] Kết quả category=membership: tìm thấy ${memberList.size} nhóm.")
        }

        // Chiến lược 4: Thử mbasic.facebook.com/groups/ (dự phòng)
        if (discoveredList.isEmpty()) {
            AppLog.i("FbWebSession", "[Chiến lược 4] Thử https://mbasic.facebook.com/groups/ ...")
            wv.loadUrl("https://mbasic.facebook.com/groups/")
            delay(3000)
            val mbasicList = extractGroupsFromCurrentPage(wv, isJoinedOnly = true)
            discoveredList.addAll(mbasicList)
            AppLog.i("FbWebSession", "[Chiến lược 4] Kết quả mbasic: tìm thấy ${mbasicList.size} nhóm.")
        }

        val finalUrl = wv.url ?: ""
        AppLog.i("FbWebSession", "Hoàn tất quét nhóm! Tìm thấy tổng cộng ${discoveredList.size} nhóm. (URL cuối: $finalUrl)")
        Result.success(discoveredList)
    }

    /**
     * Tìm kiếm nhóm theo từ khóa trên Facebook Mobile Web
     */
    suspend fun searchGroupsByKeyword(keyword: String): Result<List<DiscoveredGroup>> = withContext(Dispatchers.Main) {
        val wv = getOrCreateWebView(context)
        restoreCookies()

        if (!isLoggedIn()) {
            return@withContext Result.failure(IllegalStateException("Bạn chưa đăng nhập Facebook. Vui lòng vào tab Facebook để đăng nhập."))
        }

        val encodedQuery = URLEncoder.encode(keyword.trim(), "UTF-8")
        AppLog.i("FbWebSession", "Bắt đầu tìm kiếm nhóm theo từ khóa: '$keyword'...")

        // Chiến lược 1: Thử tìm kiếm trên mbasic
        val mbasicSearchUrl = "https://mbasic.facebook.com/search/groups/?q=$encodedQuery"
        wv.loadUrl(mbasicSearchUrl)
        delay(4000)

        var discoveredList = extractGroupsFromCurrentPage(wv, isJoinedOnly = false)

        // Chiến lược 2: Nếu mbasic trống, thử m.facebook
        if (discoveredList.isEmpty()) {
            val mobileSearchUrl = "https://m.facebook.com/search/groups/?q=$encodedQuery"
            wv.loadUrl(mobileSearchUrl)
            delay(4000)
            evaluateJs(wv, "window.scrollTo(0, 1000);")
            delay(2000)
            discoveredList = extractGroupsFromCurrentPage(wv, isJoinedOnly = false)
        }

        AppLog.i("FbWebSession", "Tìm kiếm hoàn tất! Tìm thấy ${discoveredList.size} nhóm phù hợp với từ khóa '$keyword'.")
        Result.success(discoveredList)
    }

    /**
     * Bóc tách danh sách nhóm từ màn hình hiện tại đang hiển thị trong WebView
     */
    suspend fun extractGroupsFromCurrentView(wv: WebView): List<DiscoveredGroup> {
        return extractGroupsFromCurrentPage(wv, isJoinedOnly = true)
    }

    /**
     * Bóc tách danh sách nhóm thông minh từ trang hiện tại trong WebView
     */
    private suspend fun extractGroupsFromCurrentPage(wv: WebView, isJoinedOnly: Boolean): List<DiscoveredGroup> {
        val extractScript = """
            (function() {
                var list = [];
                var seen = {};
                
                // Đóng tự động các popup/banner che chắn nếu có
                var dismissSelectors = [
                    "[aria-label='Close']", "[aria-label='Đóng']", 
                    "[aria-label='Not Now']", "[aria-label='Lúc khác']"
                ];
                for (var d = 0; d < dismissSelectors.length; d++) {
                    try {
                        var cb = document.querySelector(dismissSelectors[d]);
                        if (cb) cb.click();
                    } catch(e) {}
                }

                var anchors = document.querySelectorAll("a[href*='/groups/'], a[href*='facebook.com/groups/'], div[role='link'][data-href*='/groups/']");
                var ignored = ['create', 'discover', 'feed', 'joins', 'category', 'notifications', 'settings', 'search', 'admin', 'about', 'your_posts', 'membership', 'me'];

                for (var i = 0; i < anchors.length; i++) {
                    var a = anchors[i];
                    var href = a.href || a.getAttribute("href") || a.getAttribute("data-href") || "";
                    var m = href.match(/\/groups\/([^\/?#&]+)/i);
                    if (m && m[1]) {
                        var id = m[1].toLowerCase();
                        if (ignored.indexOf(id) === -1) {
                            var cleanUrl = "https://m.facebook.com/groups/" + m[1];
                            if (!seen[cleanUrl]) {
                                var container = a.closest("[role='listitem']") || a.closest("tr") || a.closest("li") || a.closest("div[role='article']") || a.parentElement;
                                var name = "";
                                
                                // 1. Tìm tiêu đề trong container cấu trúc React Facebook
                                if (container) {
                                    var heading = container.querySelector("h2, h3, h4, strong, [role='heading'], span[dir='auto']");
                                    if (heading && heading.textContent && heading.textContent.trim().length > 2) {
                                        name = heading.textContent.trim();
                                    }
                                }
                                
                                // 2. Lấy từ chính thẻ a nếu chưa có
                                if (!name || name.length < 2) {
                                    name = (a.innerText || a.textContent || a.getAttribute("aria-label") || a.getAttribute("title") || "").trim();
                                }
                                
                                // 3. Lấy từ container cha
                                if (!name || name.length < 2) {
                                    if (container) {
                                        name = (container.innerText || container.textContent || "").trim();
                                    }
                                }
                                
                                if (name.indexOf('\n') !== -1) {
                                    var lines = name.split('\n');
                                    for (var l = 0; l < lines.length; l++) {
                                        var line = lines[l].trim();
                                        if (line.length > 2 && 
                                            line.toLowerCase() !== 'nhóm của bạn' && 
                                            line.toLowerCase() !== 'nhóm' && 
                                            line.toLowerCase() !== 'đã tham gia' &&
                                            line.toLowerCase() !== 'joined') {
                                            name = line;
                                            break;
                                        }
                                    }
                                }
                                name = name.replace(/\s+/g, ' ').trim();
                                var lower = name.toLowerCase();
                                if (name.length >= 2 && 
                                    lower !== 'tham gia' && 
                                    lower !== 'join' && 
                                    lower !== 'xem thêm' && 
                                    lower !== 'xem tất cả' && 
                                    lower !== 'tạo nhóm' && 
                                    lower !== 'nhóm') {
                                    
                                    seen[cleanUrl] = true;
                                    list.push({
                                        name: name,
                                        url: cleanUrl,
                                        isJoined: ${if (isJoinedOnly) "true" else "true"}
                                    });
                                }
                            }
                        }
                    }
                }
                return JSON.stringify(list);
            })();
        """.trimIndent()

        val jsonResult = evaluateJs(wv, extractScript)
        if (jsonResult.isBlank() || jsonResult == "[]") return emptyList()

        val list = mutableListOf<DiscoveredGroup>()
        try {
            val jsonArray = JSONArray(jsonResult)
            for (i in 0 until jsonArray.length()) {
                val item = jsonArray.getJSONObject(i)
                val name = item.optString("name", "").trim()
                val url = item.optString("url", "").trim()
                val isJoined = item.optBoolean("isJoined", false)
                if (name.isNotEmpty() && url.isNotEmpty()) {
                    list.add(DiscoveredGroup(name = name, url = url, isJoined = isJoined))
                }
            }
        } catch (e: Exception) {
            AppLog.e("FbWebSession", "Lỗi phân tích JSON kết quả bóc tách: '$jsonResult'", e)
        }
        return list
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

        val wv = getOrCreateWebView(context)
        restoreCookies()

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

        val wv = getOrCreateWebView(context)
        restoreCookies()

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
        wv.evaluateJavascript(script) { rawResult ->
            if (rawResult == null || rawResult == "null") {
                continuation.resume("")
                return@evaluateJavascript
            }
            var text = rawResult.trim()
            if (text.startsWith("\"") && text.endsWith("\"") && text.length >= 2) {
                text = text.substring(1, text.length - 1)
                text = text.replace("\\\"", "\"")
                    .replace("\\\\", "\\")
                    .replace("\\n", "\n")
                    .replace("\\r", "\r")
                    .replace("\\t", "\t")
            }
            continuation.resume(text)
        }
    }

    suspend fun fillActiveComposer(content: String): Result<String> = withContext(Dispatchers.Main) {
        val wv = webView ?: return@withContext Result.failure(IllegalStateException("WebView chưa khởi tạo"))
        val clickComposerJs = """
            (function() {
                var btn = document.querySelector("${selectorConfig.composerOpenButton}");
                if (btn) { btn.click(); return 'OPENED'; }
                return 'NOT_FOUND';
            })();
        """.trimIndent()
        evaluateJs(wv, clickComposerJs)
        delay(1500)

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
        Result.success("Đã điền nội dung ($fillStatus)")
    }

    fun updateSelectorConfig(newConfig: SelectorConfig) {
        this.selectorConfig = newConfig
        AppLog.i("FbWebSession", "Đã cập nhật SelectorConfig phiên bản: ${newConfig.version}")
    }
}
