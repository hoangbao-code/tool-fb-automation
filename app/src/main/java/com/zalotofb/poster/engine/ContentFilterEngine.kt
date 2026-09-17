package com.zalotofb.poster.engine

import com.zalotofb.poster.data.models.AppSettings
import java.util.regex.Pattern

object ContentFilterEngine {

    // Regex phát hiện số điện thoại Việt Nam (10 số, đầu 03, 05, 07, 08, 09 hoặc +84)
    private val PHONE_REGEX = Pattern.compile(
        "(?:\\+84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\\b"
    )

    // Regex phát hiện và XÓA SẠCH hoa hồng môi giới (HH 50%, hh 1 tháng, hoa hồng 3tr...)
    private val BROKER_COMMISSION_REGEX = Pattern.compile(
        "(?i)(?:hh|hoa\\s*hồng|phí\\s*mg|phí\\s*môi\\s*giới|hh\\s*ctv|hoa\\s*hong)\\s*[:=]?\\s*\\d+(?:[.,]\\d+)?\\s*(?:%|tháng|tr|triệu|k)?(?:\\s*[-/]\\s*\\d+)?",
        Pattern.CASE_INSENSITIVE
    )

    // Regex phát hiện và xóa link nhóm Zalo cũ
    private val ZALO_LINK_REGEX = Pattern.compile(
        "https?://(?:zalo\\.me|chat\\.zalo\\.me)/\\S+",
        Pattern.CASE_INSENSITIVE
    )

    // Regex bóc tách giá tiền phòng (VD: 6tr, 6.5tr, 7tr5, 6.500.000, 7 triệu)
    private val PRICE_REGEX = Pattern.compile(
        "(?i)(?:giá|chỉ|thuê)?\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(tr|triệu|k|tr\\d+)?\\b"
    )

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
        if (trimmed.length < 15 && !hasImages) {
            return true
        }
        val lower = trimmed.lowercase()
        val spamWords = listOf("đã gửi một sticker", "đã gửi một nhãn dán", "tin nhắn đã bị thu hồi", "chấm", ".", "ok", "rep ib", "check ib")
        if (spamWords.contains(lower) && !hasImages) {
            return true
        }
        return false
    }

    /**
     * Tự động nhận diện loại phòng CHDV
     */
    fun extractRoomType(text: String): String {
        val lower = text.lowercase()
        return when {
            lower.contains("duplex") || lower.contains("gác") || lower.contains("lửng") -> "Duplex Gác Lửng"
            lower.contains("studio") || lower.contains("stu") -> "Studio Ban Công"
            lower.contains("1pn") || lower.contains("1 phòng ngủ") -> "1 Phòng Ngủ Riêng"
            lower.contains("2pn") || lower.contains("2 phòng ngủ") -> "2 Phòng Ngủ Cao Cấp"
            lower.contains("chung cư mini") || lower.contains("ccmn") -> "Chung Cư Mini"
            else -> "Căn Hộ Dịch Vụ"
        }
    }

    /**
     * Tự động nhận diện Quận / Khu vực tại TP.HCM hoặc Hà Nội
     */
    fun extractDistrict(text: String): String {
        val lower = text.lowercase()
        val districts = listOf(
            "quận 1" to "Quận 1", "q1" to "Quận 1",
            "quận 3" to "Quận 3", "q3" to "Quận 3",
            "bình thạnh" to "Bình Thạnh", "bt" to "Bình Thạnh",
            "phú nhuận" to "Phú Nhuận", "pn" to "Phú Nhuận",
            "quận 10" to "Quận 10", "q10" to "Quận 10",
            "tân bình" to "Tân Bình", "tb" to "Tân Bình",
            "gò vấp" to "Gò Vấp", "gv" to "Gò Vấp",
            "quận 7" to "Quận 7", "q7" to "Quận 7",
            "quận 2" to "TP. Thủ Đức", "thủ đức" to "TP. Thủ Đức",
            "cầu giấy" to "Cầu Giấy", "đống đa" to "Đống Đa", "thanh xuân" to "Thanh Xuân"
        )
        for ((key, name) in districts) {
            if (lower.contains(key)) return name
        }
        return "Trung Tâm"
    }

    /**
     * Bóc tách giá thuê phòng từ tin nhắn
     */
    fun extractPrice(text: String): String {
        val matcher = Pattern.compile("(?i)(\\d+(?:[.,]\\d+)?)\\s*(?:tr|triệu|k)").matcher(text)
        if (matcher.find()) {
            val numStr = matcher.group(1)?.replace(",", ".") ?: ""
            val num = numStr.toDoubleOrNull() ?: 0.0
            if (num in 2.0..50.0) {
                return String.format("%.1f", num).replace(".0", "") + " Triệu / tháng"
            }
        }
        return "Thỏa thuận"
    }

    /**
     * Xử lý làm sạch nội dung Zalo và ráp vào Form Mẫu AI chuyên nghiệp
     */
    fun processContent(rawText: String, settings: AppSettings): String {
        var cleanText = rawText

        // 1. CẮT BỎ 100% HOA HỒNG MÔI GIỚI (Cực kỳ quan trọng)
        cleanText = BROKER_COMMISSION_REGEX.matcher(cleanText).replaceAll("").trim()

        // 2. CẮT BỎ LINK ZALO CŨ
        cleanText = ZALO_LINK_REGEX.matcher(cleanText).replaceAll("").trim()

        // 3. THAY THẾ SĐT CHỦ NHÀ THÀNH SĐT CỦA MÔI GIỚI
        if (settings.replacementPhone.isNotBlank()) {
            cleanText = PHONE_REGEX.matcher(cleanText).replaceAll(settings.replacementPhone.trim())
        }

        val roomType = extractRoomType(cleanText)
        val district = extractDistrict(cleanText)
        val price = extractPrice(cleanText)

        // 4. RÁP VÀO FORM MẪU BÀI ĐĂNG CHUẨN FACEBOOK
        val template = settings.aiPromptTemplate
        val hotlineSection = settings.signatureText.ifBlank {
            "☎️ Hotline / Zalo: ${settings.replacementPhone} (Xem phòng miễn phí 24/7)"
        }

        var finalPost = template
            .replace("[TIÊU ĐỀ GIẬT TÍT & LOẠI PHÒNG]", "SIÊU PHẨM $roomType CỰC ĐẸP TẠI $district")
            .replace("[Đường, Quận - Thuận tiện di chuyển]", "Khu vực $district (Gần trường ĐH & các trục đường lớn)")
            .replace("[Giá thuê / tháng]", price)
            .replace("[HOTLINE_VA_CHUKY]", hotlineSection)

        // Đính kèm trích xuất nội thất thô nếu có
        val cleanedLines = cleanText.lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("http") && it.length > 5 }
            .take(5)
            .joinToString("\n") { "• $it" }

        if (cleanedLines.isNotBlank()) {
            finalPost = "$finalPost\n\n📝 Chi tiết thêm từ chủ nhà:\n$cleanedLines"
        }

        return finalPost.trim()
    }
}
