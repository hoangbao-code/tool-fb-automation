package com.zalotofb.poster.domain.scrubber

import com.zalotofb.poster.domain.model.RemovedSpan
import com.zalotofb.poster.domain.model.ScrubResult
import com.zalotofb.poster.domain.parser.ListingParser
import com.zalotofb.poster.domain.parser.fold1to1

object ListingScrubber {

    private const val COMM_KEY = """(?:hoa\s*hong|\bhh\b|phi\s*(?:moi\s*gioi|mg)|moi\s*gioi)"""
    private const val COMM_PREFIX = """(?:ctv|cho\s*ae|ae)?"""

    private val COMMISSION_PATTERNS = listOf(
        // 1. (?:khong|ko|no)\s*COMM_KEY
        Regex("""(?:khong|ko|no)\s*$COMM_KEY""", RegexOption.IGNORE_CASE),
        // 2. COMM_KEY\s*(?:ctv|cho\s*ae|ae)?\s*[:\-]?\s*\d{1,3}\s*%(?:\s*thang\s*dau)?
        Regex("""$COMM_KEY\s*$COMM_PREFIX\s*[:\-]?\s*\d{1,3}\s*%(?:\s*thang\s*dau)?""", RegexOption.IGNORE_CASE),
        // 3. COMM_KEY\s*[:\-]?\s*(?:\d+(?:[.,]\d+)?|nua)\s*th(?:ang)?\b
        Regex("""$COMM_KEY\s*$COMM_PREFIX\s*[:\-]?\s*(?:\d+(?:[.,]\d+)?|nua)\s*th(?:ang)?\b""", RegexOption.IGNORE_CASE),
        // 4. COMM_KEY\s*[:\-]?\s*\d+(?:[.,]\d+)?\s*(?:tr(?:ieu)?|k|vnd|d)(?![a-z])\s*\d{0,2}
        Regex("""$COMM_KEY\s*$COMM_PREFIX\s*[:\-]?\s*\d+(?:[.,]\d+)?\s*(?:tr(?:ieu)?|k|vnd|d)(?![a-z])\s*\d{0,2}""", RegexOption.IGNORE_CASE),
        // 5. COMM_KEY\s*[:\-]?\s*(?:thuong\s*luong|thoa\s*thuan|tl)\b
        Regex("""$COMM_KEY\s*$COMM_PREFIX\s*[:\-]?\s*(?:thuong\s*luong|thoa\s*thuan|tl)\b""", RegexOption.IGNORE_CASE),
        // 6. (?:ae\s*)?chia\s*(?:hh|hoa\s*hong)?\s*\d{1,3}\s*/\s*\d{1,3}
        Regex("""(?:ae\s*)?chia\s*(?:hh|hoa\s*hong)?\s*\d{1,3}\s*/\s*\d{1,3}""", RegexOption.IGNORE_CASE),
        // 7. COMM_KEY\s*[:\-]?\s*(?=\n|$)
        Regex("$COMM_KEY\\s*[:\\-]?(?=\\n|\$)", RegexOption.IGNORE_CASE)
    )

    private val ZALO_LINK_REGEX = Regex("""https?://(?:chat\.)?zalo\.me/\S+""", RegexOption.IGNORE_CASE)
    private val PHONE_REGEX = Regex("""(?<!\d)(?:\\+?84|0)\s?[35789](?:[\s.\-]?\d){8}(?!\d)""")

    private val RESIDUAL_CONTACT_LINE_REGEX = Regex(
        """^(?:lh|sdt|zalo|lien\s*he|chu\s*nha|quan\s*ly)\b.*$""",
        RegexOption.IGNORE_CASE
    )

    fun scrub(rawText: String): ScrubResult {
        val folded = rawText.fold1to1()
        val rawLength = rawText.length

        // Collect all spans to remove on folded string
        data class RawSpan(val start: Int, val end: Int, val reason: String)
        val rawSpans = mutableListOf<RawSpan>()

        // 1. Commission patterns
        for (pattern in COMMISSION_PATTERNS) {
            pattern.findAll(folded).forEach { match ->
                rawSpans.add(RawSpan(match.range.first, match.range.last + 1, "COMMISSION"))
            }
        }

        // 2. Zalo links
        ZALO_LINK_REGEX.findAll(folded).forEach { match ->
            rawSpans.add(RawSpan(match.range.first, match.range.last + 1, "ZALO_LINK"))
        }

        // 3. Phones
        PHONE_REGEX.findAll(folded).forEach { match ->
            rawSpans.add(RawSpan(match.range.first, match.range.last + 1, "PHONE"))
        }

        // If no spans, do line cleanup directly
        if (rawSpans.isEmpty()) {
            val cleaned = cleanupLines(rawText)
            return ScrubResult(
                cleanText = cleaned,
                ownerPhone = null,
                commissionNote = null,
                removedSpans = emptyList()
            )
        }

        // Merge overlapping spans
        val sortedSpans = rawSpans.sortedBy { it.start }
        val mergedSpans = mutableListOf<RawSpan>()
        for (span in sortedSpans) {
            val last = mergedSpans.lastOrNull()
            if (last == null || span.start > last.end) {
                mergedSpans.add(span)
            } else {
                val newEnd = maxOf(last.end, span.end)
                val newReason = if (last.reason == span.reason) last.reason else "${last.reason},${span.reason}"
                mergedSpans[mergedSpans.lastIndex] = RawSpan(last.start, newEnd, newReason)
            }
        }

        // Record removed spans with original text
        val removedList = mutableListOf<RemovedSpan>()
        val commNotes = mutableListOf<String>()
        val phones = mutableListOf<String>()

        for (span in mergedSpans) {
            val s = span.start.coerceIn(0, rawLength)
            val e = span.end.coerceIn(0, rawLength)
            if (s < e) {
                val text = rawText.substring(s, e)
                removedList.add(RemovedSpan(s, e, text, span.reason))
                if (span.reason.contains("COMMISSION")) {
                    commNotes.add(text.trim())
                }
                if (span.reason.contains("PHONE")) {
                    phones.add(text.trim())
                }
            }
        }

        // Slice out the spans on the raw string
        val sb = StringBuilder()
        var currentIdx = 0
        for (span in mergedSpans) {
            val s = span.start.coerceIn(0, rawLength)
            val e = span.end.coerceIn(0, rawLength)
            if (s > currentIdx) {
                sb.append(rawText.substring(currentIdx, s))
            }
            currentIdx = maxOf(currentIdx, e)
        }
        if (currentIdx < rawLength) {
            sb.append(rawText.substring(currentIdx, rawLength))
        }

        // Clean up remaining text line by line
        val cleanedText = cleanupLines(sb.toString())

        // Extract normalized owner phone
        val normalizedPhones = ListingParser.extractPhones(rawText)
        val ownerPhone = normalizedPhones.firstOrNull()

        return ScrubResult(
            cleanText = cleanedText,
            ownerPhone = ownerPhone,
            commissionNote = if (commNotes.isNotEmpty()) commNotes.joinToString(" | ") else null,
            removedSpans = removedList
        )
    }

    private fun cleanupLines(text: String): String {
        val lines = text.lines()
        val result = mutableListOf<String>()

        for (rawLine in lines) {
            var line = rawLine.trim()
            if (line.isEmpty()) continue

            // Strip any leftover phone in line
            line = PHONE_REGEX.replace(line, "").trim()
            if (line.isEmpty()) continue

            // Drop lines with length <= 3
            if (line.length <= 3) continue

            // Drop lines with only emoji or punctuation/symbols
            val hasLetterOrDigit = line.any { it.isLetterOrDigit() }
            if (!hasLetterOrDigit) continue

            // Drop residual contact lines like "LH: ", "Zalo: ", "SDT: " under 40 chars
            val foldedLine = line.fold1to1()
            if (RESIDUAL_CONTACT_LINE_REGEX.matches(foldedLine) && line.length < 40) {
                continue
            }

            // Normal line: collapse multiple spaces
            val normalizedLine = line.replace(Regex("""[ \t]+"""), " ")
            result.add(normalizedLine)
        }

        return result.joinToString("\n")
    }

    /**
     * Absolute safety check: returns true if any commission keyword/pattern remains in text.
     */
    fun hasCommission(text: String): Boolean {
        val folded = text.fold1to1()
        for (pattern in COMMISSION_PATTERNS) {
            if (pattern.containsMatchIn(folded)) {
                return true
            }
        }
        return false
    }

    /**
     * Absolute safety check: returns all remaining phone numbers found in text.
     */
    fun extractPhones(text: String): List<String> {
        return ListingParser.extractPhones(text)
    }
}
