package com.zalotofb.poster.facebook

import android.content.Context
import android.content.SharedPreferences

class FacebookSessionManager private constructor(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREF_FB_SESSION, Context.MODE_PRIVATE)

    companion object {
        private const val PREF_FB_SESSION = "fb_session_prefs"
        private const val KEY_COOKIES = "fb_cookies"
        private const val KEY_USER_ID = "fb_user_id"
        private const val KEY_USER_NAME = "fb_user_name"

        @Volatile
        private var instance: FacebookSessionManager? = null

        fun getInstance(context: Context): FacebookSessionManager {
            return instance ?: synchronized(this) {
                instance ?: FacebookSessionManager(context.applicationContext).also { instance = it }
            }
        }
    }

    fun saveSession(cookies: String, userId: String? = null, userName: String? = null) {
        val extractedId = if (!userId.isNullOrBlank()) userId else extractUserIdFromCookie(cookies)
        prefs.edit()
            .putString(KEY_COOKIES, cookies)
            .putString(KEY_USER_ID, extractedId)
            .putString(KEY_USER_NAME, userName ?: "Tài khoản Facebook ($extractedId)")
            .apply()
    }

    fun getCookies(): String = prefs.getString(KEY_COOKIES, "") ?: ""

    fun getUserId(): String = prefs.getString(KEY_USER_ID, "") ?: ""

    fun getUserName(): String = prefs.getString(KEY_USER_NAME, "Tài khoản Facebook") ?: "Tài khoản Facebook"

    fun isLoggedIn(): Boolean {
        val cookies = getCookies()
        return cookies.contains("c_user=") && cookies.contains("xs=")
    }

    fun clearSession() {
        prefs.edit().clear().apply()
    }

    private fun extractUserIdFromCookie(cookie: String): String {
        val pattern = Regex("c_user=(\d+)")
        return pattern.find(cookie)?.groupValues?.getOrNull(1) ?: ""
    }
}
