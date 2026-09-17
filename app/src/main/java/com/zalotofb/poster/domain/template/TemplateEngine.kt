package com.zalotofb.poster.domain.template

import com.zalotofb.poster.domain.model.ParsedListing
import com.zalotofb.poster.domain.scrubber.ListingScrubber
import java.util.Locale

object TemplateEngine {

    const val DEFAULT_TEMPLATE = """{TIEU_DE}
📍 Vị trí: {DIA_CHI}
🏙 Khu vực: {QUAN}
📐 Diện tích: {DIEN_TICH}
💰 Giá thuê: {GIA}
🛋 Loại phòng: {LOAI_PHONG}

✨ MÔ TẢ CHI TIẾT:
{MO_TA_SACH}

⚡ TIỆN NGHI ĐI KÈM:
{TIEN_NGHI}

📞 Liên hệ ngay: {HOTLINE}
{CHU_KY}
{HASHTAG}
{MA_THEO_DOI}"""

    private val TITLE_STYLES = listOf(
        "🔥 [HOT] CHO THUÊ {LOAI_PHONG} TẠI {QUAN} - GIÁ SIÊU TỐT 🔥",
        "✨ PHÒNG ĐẸP XỊN SÒ: {LOAI_PHONG} {QUAN} - DỌN VÀO Ở NGAY ✨",
        "🏠 CHO THUÊ CĂN HỘ {LOAI_PHONG} {QUAN} - FULL TIỆN NGHI 🏠",
        "🌟 SIÊU PHẨM {LOAI_PHONG} TRUNG TÂM {QUAN} - XEM LÀ MÊ 🌟",
        "💥 CĂN HỘ DỊCH VỤ {LOAI_PHONG} {QUAN} - GIÁ CỰC HỢP LÝ 💥"
    )

    private val HASHTAG_SETS = listOf(
        listOf("#chdv", "#thuephong", "#phongdep", "#canhodichvu"),
        listOf("#chothuephong", "#phongtro", "#timphong", "#chdvsaigon"),
        listOf("#thuenha", "#canho", "#phongfullnoithat", "#batdongsan")
    )

    fun formatPrice(min: Long?, max: Long?): String? {
        if (min == null && max == null) return null
        if (min != null && max != null && min != max) {
            val minStr = formatPriceUnit(min)
            val maxStr = formatPriceUnit(max)
            return "$minStr – $maxStr/tháng"
        }
        val p = min ?: max ?: return null
        return "${formatPriceUnit(p)}/tháng"
    }

    fun formatPriceUnit(amount: Long): String {
        val m = amount / 1_000_000.0
        val formatted = if (amount % 1_000_000L == 0L) {
            "${amount / 1_000_000L}"
        } else {
            String.format(Locale.US, "%.2f", m).trimEnd('0').trimEnd('.').replace('.', ',')
        }
        return "$formatted triệu"
    }

    fun formatArea(areaM2: Double?): String? {
        if (areaM2 == null) return null
        val formatted = if (areaM2 % 1.0 == 0.0) {
            "${areaM2.toLong()}"
        } else {
            String.format(Locale.US, "%.1f", areaM2).replace('.', ',')
        }
        return "${formatted}m²"
    }

    fun render(
        template: String = DEFAULT_TEMPLATE,
        listing: ParsedListing,
        cleanText: String,
        hotline: String? = null,
        signature: String? = null,
        trackingCode: String? = null,
        variantIndex: Int = 0,
        amenities: String? = null
    ): String {
        val normalizedVariant = if (variantIndex < 0) 0 else variantIndex

        // 1. Title variant
        val titleTemplate = TITLE_STYLES[normalizedVariant % TITLE_STYLES.size]
        val title = titleTemplate
            .replace("{LOAI_PHONG}", listing.roomType?.displayName ?: "Căn Hộ")
            .replace("{QUAN}", listing.district ?: "TP.HCM")

        // 2. Hashtags with district
        val baseHashtags = HASHTAG_SETS[normalizedVariant % HASHTAG_SETS.size].toMutableList()
        if (listing.district != null) {
            val districtTag = "#" + listing.district.foldCleanForTag()
            baseHashtags.add(0, districtTag)
        }
        val hashtags = baseHashtags.joinToString(" ")

        // 3. Tracking code formatting (e.g. #BT01)
        val trackingFormatted = trackingCode?.trim()?.let {
            if (it.startsWith("#")) it else "#$it"
        }

        // 4. Invert description / amenities order for odd variants
        val isOddVariant = (normalizedVariant % 2 == 1)

        // Sanitize address: absolutely guarantee no owner phone leaks into address
        val sanitizedAddress = listing.address?.let { rawAddr ->
            var addr = rawAddr
            for (p in ListingScrubber.extractPhones(addr)) {
                addr = addr.replace(p, "")
            }
            addr.trim().trimEnd(',', '.', '-', ':', ';')
        }

        val values = mutableMapOf<String, String?>()
        values["{TIEU_DE}"] = title
        values["{LOAI_PHONG}"] = listing.roomType?.displayName
        values["{QUAN}"] = listing.district
        values["{DIA_CHI}"] = sanitizedAddress?.ifBlank { null }
        values["{GIA}"] = formatPrice(listing.priceMin, listing.priceMax)
        values["{DIEN_TICH}"] = formatArea(listing.areaM2)

        if (isOddVariant && amenities != null && amenities.isNotBlank()) {
            values["{MO_TA_SACH}"] = amenities.trim()
            values["{TIEN_NGHI}"] = cleanText.trim().ifEmpty { null }
        } else {
            values["{MO_TA_SACH}"] = cleanText.trim().ifEmpty { null }
            values["{TIEN_NGHI}"] = amenities?.trim()?.ifEmpty { null }
        }

        values["{HOTLINE}"] = hotline?.trim()?.ifEmpty { null }
        values["{CHU_KY}"] = signature?.trim()?.ifEmpty { null }
        values["{HASHTAG}"] = hashtags
        values["{MA_THEO_DOI}"] = trackingFormatted?.ifEmpty { null }

        // Process template line by line.
        // Rule: If a line contains a placeholder and that placeholder has null/empty value,
        // delete the ENTIRE line!
        val placeholderRegex = Regex("""\{[A-Z_]+\}""")
        val resultLines = mutableListOf<String>()

        for (line in template.lines()) {
            val matches = placeholderRegex.findAll(line).toList()
            if (matches.isEmpty()) {
                resultLines.add(line)
                continue
            }

            // Check if any placeholder in this line is empty/null
            var shouldDropLine = false
            var renderedLine = line
            for (match in matches) {
                val tag = match.value
                val value = values[tag]
                if (value.isNullOrBlank()) {
                    shouldDropLine = true
                    break
                } else {
                    renderedLine = renderedLine.replace(tag, value)
                }
            }

            if (!shouldDropLine) {
                resultLines.add(renderedLine)
            }
        }

        // Collapse multiple blank lines to at most one
        val cleanedLines = mutableListOf<String>()
        var prevBlank = false
        for (l in resultLines) {
            val isBlank = l.isBlank()
            if (isBlank) {
                if (!prevBlank && cleanedLines.isNotEmpty()) {
                    cleanedLines.add("")
                }
                prevBlank = true
            } else {
                cleanedLines.add(l)
                prevBlank = false
            }
        }

        return cleanedLines.joinToString("\n").trim()
    }

    private fun String.foldCleanForTag(): String {
        return java.text.Normalizer.normalize(this, java.text.Normalizer.Form.NFD)
            .replace(Regex("""[\p{InCombiningDiacriticalMarks}\s.,\-]+"""), "")
            .replace("đ", "d")
            .replace("Đ", "d")
            .lowercase()
    }
}
