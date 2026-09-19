package com.example.posthub.domain.extractor

import com.example.posthub.domain.model.FieldDef
import java.util.regex.Pattern

object FieldExtractor {

    private val DEFAULT_REGEX_PATTERNS = mapOf(
        "gia" to """(?i)(\d+([\.,]\d+)?\s*(tr|triệu|k|tr\/tháng|usd|\$))""",
        "quan" to """(?i)(quận\s*\d+|q\.\s*\d+|bình thạnh|gò vấp|phú nhuận|tân bình|tân phú|thủ đức|quận\s*[a-z]+)""",
        "sdt" to """(0\d{9})""",
        "dien_tich" to """(?i)(\d+([\.,]\d+)?\s*(m2|m²))""",
        "loai_phong" to """(?i)(studio|1pn|2pn|3pn|duplex|gác lửng|phòng trọ)"""
    )

    /**
     * Trích xuất các trường biến từ văn bản thô dựa trên danh sách FieldDef của Workspace.
     */
    fun extractFields(rawText: String, fieldDefs: List<FieldDef>): Map<String, String> {
        val results = mutableMapOf<String, String>()

        for (def in fieldDefs) {
            if (!def.fixedValue.isNullOrBlank()) {
                results[def.key] = def.fixedValue.trim()
                continue
            }

            val regexStr = def.extractRegex?.takeIf { it.isNotBlank() } ?: DEFAULT_REGEX_PATTERNS[def.key.lowercase()]

            if (!regexStr.isNullOrBlank()) {
                val extracted = extractByRegex(rawText, regexStr)
                if (!extracted.isNullOrBlank()) {
                    results[def.key] = extracted.trim()
                }
            }
        }

        return results
    }

    private fun extractByRegex(text: String, regex: String): String? {
        return try {
            val pattern = Pattern.compile(regex)
            val matcher = pattern.matcher(text)
            if (matcher.find()) {
                if (matcher.groupCount() >= 1) {
                    matcher.group(1)
                } else {
                    matcher.group(0)
                }
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }
}
