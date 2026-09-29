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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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

data class FbPostResult(
    val status: String, // "SUCCESS", "PENDING_APPROVAL", "FAILED", "ASSISTED_READY"
    val postUrl: String? = null,
    val message: String? = null,
    val error: String? = null
)

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

    var isUserBrowsingScreen: Boolean = false
    var onGroupsAutoDiscovered: ((List<DiscoveredGroup>) -> Unit)? = null
    private val sessionScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

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

                // Tự động quét nhóm ngầm khi người dùng đang lướt bất kỳ trang nhóm nào
                if (url != null && (url.contains("/groups") || url.contains("/group")) && secureStore.isAutoGroupScanEnabled() && !secureStore.isEmergencyStop()) {
                    v?.let { wv ->
                        sessionScope.launch {
                            try {
                                delay(2000)
                                val groups = extractGroupsFromCurrentPage(wv, isJoinedOnly = true)
                                if (groups.isNotEmpty()) {
                                    onGroupsAutoDiscovered?.invoke(groups)
                                }
                            } catch (e: Exception) {
                                // Bỏ qua lỗi ngầm không ảnh hưởng trải nghiệm
                            }
                        }
                    }
                }
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

        if (isUserBrowsingScreen) {
            AppLog.i("FbWebSession", "Bỏ qua quét ngầm tự động vì người dùng đang mở tab màn hình Facebook.")
            return@withContext Result.success(emptyList())
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
     * Trả về FbPostResult phân biệt rõ:
     * - SUCCESS: Đã đăng thành công (kèm postUrl nếu có)
     * - PENDING_APPROVAL: Nhóm cần Quản trị viên duyệt bài
     * - FAILED: Thất bại kèm lý do cụ thể (bị chặn, lỗi selector, timeout...)
     */
    suspend fun postToGroup(
        groupUrl: String,
        content: String,
        isAssisted: Boolean = true
    ): Result<FbPostResult> = withContext(Dispatchers.Main) {
        if (secureStore.isEmergencyStop()) {
            return@withContext Result.failure(IllegalStateException("Đang trong trạng thái DỪNG KHẨN CẤP! Vui lòng kiểm tra lại tài khoản."))
        }

        if (secureStore.isDryRun()) {
            AppLog.i("FbWebSession", "[DRY-RUN] Giả lập đăng bài thành công vào: $groupUrl (Nội dung: ${content.take(50)}...)")
            return@withContext Result.success(FbPostResult(status = "SUCCESS", postUrl = groupUrl, message = "DRY-RUN thành công"))
        }

        val wv = getOrCreateWebView(context)
        restoreCookies()

        // 1. Mở nhóm
        AppLog.i("FbWebSession", "Bắt đầu mở nhóm: $groupUrl")
        openGroup(groupUrl)
        delay(JitterPolicy.calculateActionDelayMillis(4, 6))

        // 2. Tự động kiểm tra Checkpoint / Phiên hết hạn trước khi đăng
        val initialCheckJs = """
            (function() {
                var url = window.location.href.toLowerCase();
                var text = (document.body.innerText || '').toLowerCase();
                if (url.includes('/login') || url.includes('checkpoint') || text.includes('checkpoint') || text.includes('xác minh danh tính')) {
                    return JSON.stringify({ status: 'FAILED', error: 'Tài khoản dính checkpoint hoặc phiên đăng nhập đã hết hạn.' });
                }
                if (text.includes('chỉ quản trị viên mới có thể đăng') || text.includes('only admins can post')) {
                    return JSON.stringify({ status: 'FAILED', error: 'Nhóm này cài đặt chỉ Quản trị viên mới được đăng bài.' });
                }
                if (text.includes('tạm thời bị chặn') || text.includes('temporarily blocked') || text.includes('bị hạn chế')) {
                    return JSON.stringify({ status: 'FAILED', error: 'Tài khoản đang bị Facebook tạm khóa tính năng đăng bài trong nhóm.' });
                }
                return JSON.stringify({ status: 'OK' });
            })();
        """.trimIndent()

        val checkResStr = evaluateJs(wv, initialCheckJs)
        try {
            val checkJson = org.json.JSONObject(checkResStr)
            if (checkJson.optString("status") == "FAILED") {
                val err = checkJson.optString("error", "Lỗi trạng thái tài khoản")
                AppLog.e("FbWebSession", "Không thể đăng bài vào $groupUrl: $err")
                return@withContext Result.success(FbPostResult(status = "FAILED", error = err))
            }
        } catch (_: Exception) {}

        // 3. Mở khung soạn thảo (Composer Trigger)
        val openTriggerJs = """
            (function() {
                try {
                    // Đóng thông báo hoặc popup che chắn nếu có
                    var closeBtns = document.querySelectorAll("[aria-label='Close'], [aria-label='Đóng'], [aria-label='Not Now'], [aria-label='Lúc khác']");
                    for (var c = 0; c < closeBtns.length; c++) {
                        try { closeBtns[c].click(); } catch(e) {}
                    }

                    // Tìm nút mở khung soạn bài (Composer Trigger)
                    var triggerKeywords = [
                        'bạn viết gì đi',
                        'tạo bài viết công khai',
                        'tạo bài viết',
                        'bạn đang nghĩ gì',
                        'viết gì đó',
                        'write something',
                        'create a public post',
                        'create a post',
                        'what\'s on your mind'
                    ];

                    var triggerBtn = null;
                    var allEls = Array.from(document.querySelectorAll('span, div[role="button"], div[tabindex="0"], div[data-action-id="composer"]'));
                    for (var i = 0; i < allEls.length; i++) {
                        var el = allEls[i];
                        var text = (el.innerText || el.textContent || '').trim().toLowerCase();
                        var aria = (el.getAttribute('aria-label') || '').toLowerCase();
                        for (var k = 0; k < triggerKeywords.length; k++) {
                            var kw = triggerKeywords[k];
                            if (text === kw || (text.includes(kw) && text.length < 50) || aria.includes(kw)) {
                                var btn = el.closest('[role="button"]') || el.closest('[tabindex="0"]') || el;
                                if (btn && btn.offsetParent !== null) {
                                    triggerBtn = btn;
                                    break;
                                }
                            }
                        }
                        if (triggerBtn) break;
                    }

                    if (!triggerBtn) {
                        triggerBtn = document.querySelector('div[role="region"] div[role="button"], div[data-pagelet="GroupInlineComposer"] div[role="button"]');
                    }

                    if (triggerBtn) {
                        triggerBtn.click();
                    }

                    return JSON.stringify({ status: triggerBtn ? 'TRIGGER_CLICKED' : 'TRIGGER_NOT_FOUND' });
                } catch(e) {
                    return JSON.stringify({ status: 'ERROR', error: e.toString() });
                }
            })();
        """.trimIndent()

        val triggerRes = evaluateJs(wv, openTriggerJs)
        AppLog.i("FbWebSession", "Kết quả tìm và click mở Composer: $triggerRes")
        delay(JitterPolicy.calculateActionDelayMillis(2, 4))

        // 4. Nhập nội dung bài viết vào Editor
        val escapedContent = org.json.JSONObject.quote(content)
        val fillTextJs = """
            (function() {
                try {
                    var dialog = document.querySelector('div[role="dialog"]');
                    var ctx = dialog || document;
                    var editor = ctx.querySelector('div[role="textbox"][contenteditable="true"], div[contenteditable="true"], textarea[name="xc_message"], textarea');

                    if (!editor) {
                        var pageText = (document.body.innerText || '').toLowerCase();
                        if (pageText.includes('tham gia nhóm') || pageText.includes('join group')) {
                            return JSON.stringify({ status: 'FAILED', error: 'Bạn chưa tham gia nhóm này.' });
                        }
                        return JSON.stringify({ status: 'FAILED', error: 'Không tìm thấy khung soạn thảo bài viết.' });
                    }

                    editor.focus();
                    var textToPost = $escapedContent;

                    var inserted = false;
                    try {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('delete', false, null);
                        inserted = document.execCommand('insertText', false, textToPost);
                    } catch(e) {}

                    if (!inserted || !editor.innerText.trim()) {
                        try {
                            var lines = textToPost.split(/\r?\n/);
                            for (var l = 0; l < lines.length; l++) {
                                if (lines[l].length > 0) document.execCommand('insertText', false, lines[l]);
                                if (l < lines.length - 1) document.execCommand('insertParagraph', false, null);
                            }
                            if (editor.innerText && editor.innerText.trim().length > 0) inserted = true;
                        } catch(e) {}
                    }

                    if (!inserted || !editor.innerText.trim()) {
                        if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
                            editor.value = textToPost;
                        } else {
                            editor.innerText = textToPost;
                        }
                    }

                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    editor.dispatchEvent(new Event('change', { bubbles: true }));

                    return JSON.stringify({ status: 'FILLED' });
                } catch(e) {
                    return JSON.stringify({ status: 'FAILED', error: e.toString() });
                }
            })();
        """.trimIndent()

        val fillRes = evaluateJs(wv, fillTextJs)
        AppLog.i("FbWebSession", "Kết quả điền nội dung bài viết: $fillRes")

        try {
            val fillJson = org.json.JSONObject(fillRes)
            if (fillJson.optString("status") == "FAILED") {
                val err = fillJson.optString("error", "Không thể điền nội dung")
                return@withContext Result.success(FbPostResult(status = "FAILED", error = err))
            }
        } catch (_: Exception) {}

        if (isAssisted) {
            AppLog.i("FbWebSession", "Chế độ TRỢ LỰC (ASSISTED): Đã điền sẵn bài viết. Mời bạn kiểm tra lại trên màn hình và tự bấm 'Đăng'!")
            return@withContext Result.success(FbPostResult(status = "ASSISTED_READY", message = "Đã điền sẵn bài viết"))
        }

        // Chế độ AUTO: Đợi giãn cách Jitter rồi tự bấm nút Đăng
        val delayBeforeSubmit = JitterPolicy.calculateActionDelayMillis(3, 5)
        AppLog.i("FbWebSession", "Chế độ TỰ ĐỘNG (AUTO): Chờ ${delayBeforeSubmit / 1000}s trước khi bấm Đăng...")
        delay(delayBeforeSubmit)

        val clickSubmitJs = """
            (function() {
                try {
                    var postKeywords = ['đăng', 'post', 'chia sẻ', 'publish'];
                    var submitBtn = null;
                    var d = document.querySelector('div[role="dialog"]') || document;
                    var buttons = Array.from(d.querySelectorAll('div[role="button"], button'));
                    for (var b = 0; b < buttons.length; b++) {
                        var btn = buttons[b];
                        var btnText = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                        var btnAria = (btn.getAttribute('aria-label') || '').toLowerCase();
                        for (var p = 0; p < postKeywords.length; p++) {
                            var pk = postKeywords[p];
                            if (btnText === pk || (btnText.includes(pk) && btnText.length < 20) || btnAria.includes(pk)) {
                                if (btn.getAttribute('aria-disabled') !== 'true' && !btn.disabled && btn.offsetParent !== null) {
                                    submitBtn = btn;
                                    break;
                                }
                            }
                        }
                        if (submitBtn) break;
                    }

                    if (!submitBtn) {
                        submitBtn = d.querySelector('div[aria-label*="Đăng"][role="button"], div[aria-label*="Post"][role="button"], button[type="submit"]');
                    }

                    if (submitBtn) {
                        submitBtn.click();
                        return JSON.stringify({ status: 'CLICKED_SUBMIT' });
                    }
                    return JSON.stringify({ status: 'SUBMIT_BTN_NOT_FOUND' });
                } catch(e) {
                    return JSON.stringify({ status: 'ERROR', error: e.toString() });
                }
            })();
        """.trimIndent()

        val submitRes = evaluateJs(wv, clickSubmitJs)
        AppLog.i("FbWebSession", "Kết quả bấm nút đăng tự động: $submitRes")

        if (submitRes.contains("SUBMIT_BTN_NOT_FOUND")) {
            return@withContext Result.success(FbPostResult(status = "FAILED", error = "Không tìm thấy nút Đăng hoặc nút Đăng đang bị khóa"))
        }

        // Chờ phản hồi từ Facebook (6 giây) để kiểm tra kết quả thật
        AppLog.i("FbWebSession", "Đang chờ Facebook xử lý bài đăng và theo dõi trạng thái...")
        delay(6000)

        val verifyJs = """
            (function() {
                var bodyText = (document.body.innerText || '').toLowerCase();
                var curUrl = window.location.href;

                // 1. Kiểm tra trạng thái Chờ duyệt
                if (bodyText.includes('chờ phê duyệt') || bodyText.includes('quản trị viên sẽ xét duyệt') || 
                    bodyText.includes('pending') || bodyText.includes('đang chờ duyệt') || 
                    curUrl.includes('pending_posts')) {
                    return JSON.stringify({
                        status: 'PENDING_APPROVAL',
                        message: 'Bài viết đang chờ Quản trị viên duyệt',
                        url: curUrl.includes('pending_posts') ? curUrl : curUrl + 'pending_posts'
                    });
                }

                // 2. Kiểm tra chặn tính năng / Spam block
                if (bodyText.includes('bị chặn') || bodyText.includes('không thể đăng') || 
                    bodyText.includes('vi phạm tiêu chuẩn') || bodyText.includes('temporarily blocked')) {
                    return JSON.stringify({
                        status: 'FAILED',
                        error: 'Bị Facebook tạm chặn đăng bài vào nhóm này (Spam filter hoặc vi phạm quy tắc)'
                    });
                }

                // 3. Kiểm tra xem dialog đăng bài đã đóng chưa
                var dialog = document.querySelector('div[role="dialog"]');
                if (!dialog) {
                    // Dialog đã đóng => Bài viết đã đăng lên nhóm!
                    var postLink = null;
                    var links = document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
                    if (links.length > 0) {
                        postLink = links[0].href;
                    }
                    return JSON.stringify({
                        status: 'SUCCESS',
                        postUrl: postLink || curUrl,
                        message: 'Đăng bài thành công'
                    });
                }

                // Nếu dialog vẫn còn mở, kiểm tra xem có thông báo lỗi gì không
                var errorBox = dialog.querySelector('[role="alert"], [data-testid="error-message"]');
                var errMsg = errorBox ? (errorBox.innerText || '').trim() : 'Nút Đăng không phản hồi hoặc Facebook từ chối bài viết';
                return JSON.stringify({ status: 'FAILED', error: errMsg });
            })();
        """.trimIndent()

        val verifyRes = evaluateJs(wv, verifyJs)
        AppLog.i("FbWebSession", "Kết quả xác thực sau khi đăng: $verifyRes")

        try {
            val vJson = org.json.JSONObject(verifyRes)
            val st = vJson.optString("status", "FAILED")
            when (st) {
                "SUCCESS" -> {
                    val pUrl = vJson.optString("postUrl", groupUrl)
                    AppLog.i("FbWebSession", "✓ ĐĂNG BÀI THÀNH CÔNG vào $groupUrl (Link: $pUrl)")
                    Result.success(FbPostResult(status = "SUCCESS", postUrl = pUrl, message = "Đăng thành công"))
                }
                "PENDING_APPROVAL" -> {
                    val pendingUrl = vJson.optString("url", groupUrl)
                    AppLog.w("FbWebSession", "⏳ BÀI VIẾT ĐANG CHỜ DUYỆT tại nhóm: $groupUrl")
                    Result.success(FbPostResult(status = "PENDING_APPROVAL", postUrl = pendingUrl, message = "Đang chờ Quản trị viên duyệt"))
                }
                else -> {
                    val err = vJson.optString("error", "Đăng bài thất bại")
                    AppLog.e("FbWebSession", "✗ ĐĂNG BÀI THẤT BẠI tại $groupUrl: $err")
                    Result.success(FbPostResult(status = "FAILED", error = err))
                }
            }
        } catch (e: Exception) {
            AppLog.e("FbWebSession", "Lỗi phân tích kết quả xác thực: ${e.message}")
            Result.success(FbPostResult(status = "FAILED", error = "Lỗi xác thực phản hồi từ Facebook: ${e.message}"))
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
        val escapedContent = org.json.JSONObject.quote(content)

        val fillScript = """
            (function() {
                try {
                    var triggerKeywords = ['bạn viết gì đi', 'tạo bài viết công khai', 'tạo bài viết', 'bạn đang nghĩ gì', 'viết gì đó', 'write something'];
                    var allEls = Array.from(document.querySelectorAll('span, div[role="button"], div[tabindex="0"]'));
                    for (var i = 0; i < allEls.length; i++) {
                        var el = allEls[i];
                        var text = (el.innerText || el.textContent || '').trim().toLowerCase();
                        for (var k = 0; k < triggerKeywords.length; k++) {
                            if (text.includes(triggerKeywords[k])) {
                                var b = el.closest('[role="button"]') || el;
                                if (b && b.offsetParent !== null) { b.click(); break; }
                            }
                        }
                    }

                    setTimeout(function() {
                        var d = document.querySelector('div[role="dialog"]') || document;
                        var ed = d.querySelector('div[role="textbox"][contenteditable="true"], div[contenteditable="true"], textarea');
                        if (ed) {
                            ed.focus();
                            document.execCommand('selectAll', false, null);
                            document.execCommand('delete', false, null);
                            document.execCommand('insertText', false, $escapedContent);
                            ed.dispatchEvent(new Event('input', { bubbles: true }));
                        }
                    }, 1000);

                    return 'TRIGGERED_FILL';
                } catch(e) {
                    return e.toString();
                }
            })();
        """.trimIndent()

        evaluateJs(wv, fillScript)
        Result.success("Đã điền nội dung")
    }

    fun updateSelectorConfig(newConfig: SelectorConfig) {
        this.selectorConfig = newConfig
        AppLog.i("FbWebSession", "Đã cập nhật SelectorConfig phiên bản: ${newConfig.version}")
    }
}
