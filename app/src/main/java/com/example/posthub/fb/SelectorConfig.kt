package com.example.posthub.fb

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

data class SelectorConfig(
    val version: Int = 1,
    val composerOpenButton: String = "div[role='button']:has-text('Bạn đang nghĩ gì'), div[role='button']:has-text('Viết gì đó'), div[data-action-id='composer']",
    val composerTextArea: String = "div[role='textbox'], textarea[name='view_post'], div[contenteditable='true']",
    val composerSubmitButton: String = "div[role='button']:has-text('Đăng'), div[role='button']:has-text('Post'), button[type='submit']",
    val groupJoinButton: String = "div[role='button']:has-text('Tham gia nhóm'), div[role='button']:has-text('Join Group')",
    val checkpointSignatures: List<String> = listOf(
        "checkpoint", "captcha", "bị hạn chế", "tạm thời bị khóa", "xác minh danh tính", "security check", "temporarily blocked"
    )
) {
    companion object {
        val DEFAULT = SelectorConfig()

        fun fromJson(jsonStr: String, expectedSha256: String? = null): Result<SelectorConfig> {
            return try {
                if (!expectedSha256.isNullOrBlank()) {
                    val digest = MessageDigest.getInstance("SHA-256")
                    val hash = digest.digest(jsonStr.toByteArray())
                    val computedSha = hash.joinToString("") { "%02x".format(it) }
                    if (!computedSha.equals(expectedSha256, ignoreCase = true)) {
                        return Result.failure(SecurityException("SHA-256 của SelectorConfig không khớp!"))
                    }
                }

                val obj = JSONObject(jsonStr)
                val signatures = mutableListOf<String>()
                val sigArray = obj.optJSONArray("checkpointSignatures") ?: JSONArray()
                for (i in 0 until sigArray.length()) {
                    signatures.add(sigArray.getString(i))
                }

                val config = SelectorConfig(
                    version = obj.optInt("version", 1),
                    composerOpenButton = obj.optString("composerOpenButton", DEFAULT.composerOpenButton),
                    composerTextArea = obj.optString("composerTextArea", DEFAULT.composerTextArea),
                    composerSubmitButton = obj.optString("composerSubmitButton", DEFAULT.composerSubmitButton),
                    groupJoinButton = obj.optString("groupJoinButton", DEFAULT.groupJoinButton),
                    checkpointSignatures = if (signatures.isNotEmpty()) signatures else DEFAULT.checkpointSignatures
                )
                Result.success(config)
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }
}
