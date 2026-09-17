package com.zalotofb.poster.data.local

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class PreferenceStorage(context: Context) {

    private val prefs = try {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "chdv_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        context.getSharedPreferences("chdv_fallback_prefs", Context.MODE_PRIVATE)
    }

    var hotline: String?
        get() = prefs.getString(KEY_HOTLINE, null)
        set(value) = prefs.edit().putString(KEY_HOTLINE, value).apply()

    var signature: String?
        get() = prefs.getString(KEY_SIGNATURE, "Môi giới căn hộ dịch vụ TP.HCM")
        set(value) = prefs.edit().putString(KEY_SIGNATURE, value).apply()

    var customTemplate: String?
        get() = prefs.getString(KEY_CUSTOM_TEMPLATE, null)
        set(value) = prefs.edit().putString(KEY_CUSTOM_TEMPLATE, value).apply()

    var maxGroupsPerSessionWarning: Int
        get() = prefs.getInt(KEY_MAX_GROUPS_WARNING, 15)
        set(value) = prefs.edit().putInt(KEY_MAX_GROUPS_WARNING, value).apply()

    companion object {
        private const val KEY_HOTLINE = "secure_hotline"
        private const val KEY_SIGNATURE = "secure_signature"
        private const val KEY_CUSTOM_TEMPLATE = "custom_template"
        private const val KEY_MAX_GROUPS_WARNING = "max_groups_warning"
    }
}
