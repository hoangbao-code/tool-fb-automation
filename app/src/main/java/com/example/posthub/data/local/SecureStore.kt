package com.example.posthub.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.example.posthub.data.AppLog

class SecureStore(context: Context) {

    private val prefs: SharedPreferences = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        EncryptedSharedPreferences.create(
            context,
            "jammy_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        AppLog.e("SecureStore", "Không thể khởi tạo EncryptedSharedPreferences, fallback SharedPreferences", e)
        context.getSharedPreferences("jammy_prefs_fallback", Context.MODE_PRIVATE)
    }

    // Cookie & Facebook Session
    fun saveFbCookies(cookies: String) {
        prefs.edit().putString(KEY_FB_COOKIES, cookies).apply()
    }

    fun getFbCookies(): String = prefs.getString(KEY_FB_COOKIES, "") ?: ""

    fun saveFbAccountName(name: String) {
        prefs.edit().putString(KEY_FB_ACCOUNT_NAME, name).apply()
    }

    fun getFbAccountName(): String = prefs.getString(KEY_FB_ACCOUNT_NAME, "") ?: ""

    fun clearFbSession() {
        prefs.edit()
            .remove(KEY_FB_COOKIES)
            .remove(KEY_FB_ACCOUNT_NAME)
            .apply()
    }

    // Zalo Configuration
    fun getZaloPackage(): String = prefs.getString(KEY_ZALO_PACKAGE, "com.zing.zalo") ?: "com.zing.zalo"

    fun setZaloPackage(pkg: String) {
        prefs.edit().putString(KEY_ZALO_PACKAGE, pkg).apply()
    }

    fun getMergeWindowSeconds(): Int = prefs.getInt(KEY_MERGE_WINDOW_SEC, 20)

    fun setMergeWindowSeconds(sec: Int) {
        prefs.edit().putInt(KEY_MERGE_WINDOW_SEC, sec).apply()
    }

    // Safeguards & Limits
    fun getMaxPostsPerDay(): Int = prefs.getInt(KEY_MAX_POSTS_PER_DAY, 5)

    fun setMaxPostsPerDay(max: Int) {
        prefs.edit().putInt(KEY_MAX_POSTS_PER_DAY, max).apply()
    }

    fun getMaxJoinsPerDay(): Int = prefs.getInt(KEY_MAX_JOINS_PER_DAY, 3)

    fun setMaxJoinsPerDay(max: Int) {
        prefs.edit().putInt(KEY_MAX_JOINS_PER_DAY, max).apply()
    }

    fun getActiveHourStart(): Int = prefs.getInt(KEY_ACTIVE_HOUR_START, 8)

    fun getActiveHourEnd(): Int = prefs.getInt(KEY_ACTIVE_HOUR_END, 22)

    fun setActiveHours(start: Int, end: Int) {
        prefs.edit()
            .putInt(KEY_ACTIVE_HOUR_START, start)
            .putInt(KEY_ACTIVE_HOUR_END, end)
            .apply()
    }

    fun isEmergencyStop(): Boolean = prefs.getBoolean(KEY_EMERGENCY_STOP, false)

    fun setEmergencyStop(stop: Boolean) {
        prefs.edit().putBoolean(KEY_EMERGENCY_STOP, stop).apply()
        if (stop) {
            AppLog.w("SecureStore", "DỪNG KHẨN CẤP ĐÃ ĐƯỢC KÍCH HOẠT! Mọi tiến trình đăng bài bị tạm dừng.")
        }
    }

    fun isDryRun(): Boolean = prefs.getBoolean(KEY_DRY_RUN, false)

    fun setDryRun(dryRun: Boolean) {
        prefs.edit().putBoolean(KEY_DRY_RUN, dryRun).apply()
    }

    fun isBiometricEnabled(): Boolean = prefs.getBoolean(KEY_BIOMETRIC_LOCK, false)

    fun setBiometricEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_BIOMETRIC_LOCK, enabled).apply()
    }

    // Kho câu trả lời xét duyệt vào nhóm (Answer Pool)
    fun getAnswerPool(): List<String> {
        val raw = prefs.getString(KEY_ANSWER_POOL, null)
        if (raw.isNullOrBlank()) {
            return listOf(
                "Tôi đồng ý với tất cả nội quy và quy định của nhóm.",
                "Tôi là chính chủ / môi giới uy tín, cam kết đăng tin đúng sự thật.",
                "Cam kết không spam, giữ gìn môi trường nhóm văn minh."
            )
        }
        return raw.split(";;;").filter { it.isNotBlank() }
    }

    fun saveAnswerPool(answers: List<String>) {
        val joined = answers.joinToString(";;;")
        prefs.edit().putString(KEY_ANSWER_POOL, joined).apply()
    }

    // Nhóm Zalo được chỉ định theo dõi
    fun getMonitoredZaloGroups(): Set<String> {
        val raw = prefs.getString(KEY_MONITORED_ZALO_GROUPS, null) ?: return emptySet()
        return raw.split(";;;").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
    }

    fun setMonitoredZaloGroups(groups: Set<String>) {
        val joined = groups.filter { it.isNotBlank() }.joinToString(";;;")
        prefs.edit().putString(KEY_MONITORED_ZALO_GROUPS, joined).apply()
    }

    fun addMonitoredZaloGroup(groupName: String) {
        val clean = groupName.trim()
        if (clean.isEmpty()) return
        val current = getMonitoredZaloGroups().toMutableSet()
        current.add(clean)
        setMonitoredZaloGroups(current)
    }

    fun removeMonitoredZaloGroup(groupName: String) {
        val clean = groupName.trim()
        val current = getMonitoredZaloGroups().toMutableSet()
        current.remove(clean)
        setMonitoredZaloGroups(current)
    }

    fun isGroupMonitored(groupName: String): Boolean {
        val monitored = getMonitoredZaloGroups()
        if (monitored.isEmpty()) return false // Nếu chưa chọn nhóm nào thì chưa theo dõi
        val clean = groupName.trim().lowercase()
        return monitored.any { it.lowercase() == clean || clean.contains(it.lowercase()) || it.lowercase().contains(clean) }
    }

    // Cấu hình AI Gemini
    fun getGeminiApiKey(): String = prefs.getString(KEY_GEMINI_API_KEY, "") ?: ""

    fun setGeminiApiKey(key: String) {
        prefs.edit().putString(KEY_GEMINI_API_KEY, key.trim()).apply()
    }

    fun getAiPromptTemplate(): String {
        return prefs.getString(KEY_AI_PROMPT_TEMPLATE, DEFAULT_AI_PROMPT) ?: DEFAULT_AI_PROMPT
    }

    fun setAiPromptTemplate(prompt: String) {
        prefs.edit().putString(KEY_AI_PROMPT_TEMPLATE, prompt).apply()
    }

    fun isAiAutoRewriteEnabled(): Boolean = prefs.getBoolean(KEY_AI_AUTO_REWRITE, false)

    fun setAiAutoRewriteEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AI_AUTO_REWRITE, enabled).apply()
    }

    fun getAiModel(): String = prefs.getString(KEY_AI_MODEL, "gemini-1.5-flash") ?: "gemini-1.5-flash"

    fun setAiModel(model: String) {
        prefs.edit().putString(KEY_AI_MODEL, model).apply()
    }

    fun isAutoCheckUpdatesEnabled(): Boolean = prefs.getBoolean(KEY_AUTO_CHECK_UPDATES, true)

    fun setAutoCheckUpdatesEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_AUTO_CHECK_UPDATES, enabled).apply()
    }

    // Chữ ký bài đăng (Hotline / Zalo / Thông tin liên hệ cố định)
    fun getPostSignature(): String = prefs.getString(KEY_POST_SIGNATURE, "") ?: ""

    fun setPostSignature(signature: String) {
        prefs.edit().putString(KEY_POST_SIGNATURE, signature.trim()).apply()
    }

    // Số ngày tự động dọn dẹp tin đã đăng (mặc định 7 ngày = 1 tuần)
    fun getAutoCleanupDays(): Int = prefs.getInt(KEY_AUTO_CLEANUP_DAYS, 7)

    fun setAutoCleanupDays(days: Int) {
        prefs.edit().putInt(KEY_AUTO_CLEANUP_DAYS, days).apply()
    }

    // Số ngày giới hạn quét nhóm tham gia (mặc định 30 ngày = 1 tháng)
    fun getGroupScanLookbackDays(): Int = prefs.getInt(KEY_GROUP_SCAN_LOOKBACK_DAYS, 30)

    fun setGroupScanLookbackDays(days: Int) {
        prefs.edit().putInt(KEY_GROUP_SCAN_LOOKBACK_DAYS, days).apply()
    }

    // Ghi nhớ nhóm Facebook đã chọn gần nhất
    fun getLastSelectedGroupIds(): Set<Long> {
        val str = prefs.getString(KEY_LAST_SELECTED_GROUPS, "") ?: ""
        if (str.isBlank()) return emptySet()
        return str.split(",").mapNotNull { it.trim().toLongOrNull() }.toSet()
    }

    fun setLastSelectedGroupIds(ids: Set<Long>) {
        val str = ids.joinToString(",")
        prefs.edit().putString(KEY_LAST_SELECTED_GROUPS, str).apply()
    }

    companion object {
        private const val KEY_FB_COOKIES = "fb_cookies"
        private const val KEY_FB_ACCOUNT_NAME = "fb_account_name"
        private const val KEY_ZALO_PACKAGE = "zalo_package"
        private const val KEY_MERGE_WINDOW_SEC = "merge_window_sec"
        private const val KEY_MAX_POSTS_PER_DAY = "max_posts_per_day"
        private const val KEY_MAX_JOINS_PER_DAY = "max_joins_per_day"
        private const val KEY_ACTIVE_HOUR_START = "active_hour_start"
        private const val KEY_ACTIVE_HOUR_END = "active_hour_end"
        private const val KEY_EMERGENCY_STOP = "emergency_stop"
        private const val KEY_DRY_RUN = "dry_run"
        private const val KEY_BIOMETRIC_LOCK = "biometric_lock"
        private const val KEY_ANSWER_POOL = "answer_pool"
        private const val KEY_MONITORED_ZALO_GROUPS = "monitored_zalo_groups"
        private const val KEY_GEMINI_API_KEY = "gemini_api_key"
        private const val KEY_AI_PROMPT_TEMPLATE = "ai_prompt_template"
        private const val KEY_AI_AUTO_REWRITE = "ai_auto_rewrite"
        private const val KEY_AI_MODEL = "ai_model"
        private const val KEY_AUTO_CHECK_UPDATES = "auto_check_updates"
        private const val KEY_POST_SIGNATURE = "post_signature"
        private const val KEY_AUTO_CLEANUP_DAYS = "auto_cleanup_days"
        private const val KEY_GROUP_SCAN_LOOKBACK_DAYS = "group_scan_lookback_days"
        private const val KEY_LAST_SELECTED_GROUPS = "last_selected_groups"

        val DEFAULT_AI_PROMPT = """
Bạn là chuyên gia soạn thảo bài đăng mạng xã hội chuyên nghiệp.
Nhiệm vụ: Hãy viết lại tin nhắn sau thành bài đăng Facebook hấp dẫn, chuẩn phong cách bán hàng:
- Làm nổi bật thông tin: Giá, Vị trí/Khu vực, Đặc điểm nổi bật, Liên hệ.
- Xóa bỏ các ký tự rác, viết hoa các tiêu đề mục và thêm emoji bắt mắt.
- Thêm lời kêu gọi hành động (Call to action) ngắn gọn ở cuối.
- Giữ lại đầy đủ số điện thoại và thông tin liên hệ gốc.

Nội dung gốc:
{CONTENT}
""".trimIndent()
    }
}
