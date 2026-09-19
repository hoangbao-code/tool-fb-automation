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
    }
}
