package com.zalotofb.poster.engine

import com.zalotofb.poster.data.models.AppSettings
import java.util.regex.Pattern

object ContentFilterEngine {

    // Regex nhận diện số điện thoại di động Việt Nam (10 số, đầu 03, 05, 07, 08, 09 hoặc +84)
    private val VIETNAM_PHONE_REGEX = Pattern.compile(
        "(?:\\+84|0)(?:3[2-9]|5[6|8|9]|7[0|6-9]|8[1-9]|9[0-9])[0-9]{7}\\b"
    )

    // Regex xóa các link nhóm Zalo hoặc link spam thường gặp
    private val ZALO_LINK_REGEX = Pattern.compile(
        "https?://(?:zalo\\.me|chat\\.zalo\\.me)/\\S+",
        Pattern.CASE_INSENSITIVE
    )

    /**
     * Kiểm tra xem tin nhắn có thuộc nhóm Zalo được cấu hình theo dõi không
     */
    fun isGroupMonitored(groupName: String, settings: AppSettings): Boolean {
        if (settings.monitoredZaloGroups.isBlank()) return true
        val targets = settings.monitoredZaloGroups.split(",")
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
        
        if (targets.isEmpty()) return true
        val lowerGroupName = groupName.lowercase()
        return targets.any { lowerGroupName.contains(it) }
    }

    /**
     * Kiểm tra tin nhắn có phải tin rác hoặc quá ngắn không
     */
    fun isSpamOrIgnored(content: String, hasImages: Boolean, settings: AppSettings): Boolean {
        val trimmed = content.trim()
        if (trimmed.length < settings.minContentLength && !hasImages) {
            return true
        }
        val lower = trimmed.lowercase()
        val spamWords = listOf("đã gửi một sticker", "đã gửi một nhãn dán", "tin nhắn đã bị thu hồi", "chấm", ".")
        if (spamWords.contains(lower) && !hasImages) {
            return true
        }
        return false
    }

    /**
     * Xử lý nội dung văn bản: Thay thế SĐT, xóa link Zalo, thêm chữ ký
     */
    fun processContent(originalText: String, settings: AppSettings): String {
        var text = originalText

        // 1. Thay thế số điện thoại cũ bằng số mới (nếu được thiết lập)
        if (settings.replacementPhone.isNotBlank()) {
            val matcher = VIETNAM_PHONE_REGEX.matcher(text)
            text = matcher.replaceAll(settings.replacementPhone.trim())
        }

        // 2. Xóa các link Zalo cũ nếu có
        text = ZALO_LINK_REGEX.matcher(text).replaceAll("").trim()

        // 3. Thêm Chữ ký / Lời kết / Hotline / Hashtag cá nhân
        if (settings.signatureText.isNotBlank()) {
            text = "$text\n\n${settings.signatureText.trim()}"
        }

        return text.trim()
    }
}
