package com.zalotofb.poster.domain.parser

import com.zalotofb.poster.domain.model.ParsedListing
import com.zalotofb.poster.domain.model.PriceResult
import com.zalotofb.poster.domain.model.RoomType

object ListingParser {

    private val PHONE_REGEX = Regex("""(?<!\d)(?:\+?84|0)\s?[35789](?:[\s.\-]?\d){8}(?!\d)""")
    private val AREA_REGEX = Regex("""(?<!\w)(\d{1,3}(?:[.,]\d)?)\s*(?:m2|m²)""", RegexOption.IGNORE_CASE)
    private val BILLION_REGEX = Regex("""(?:\d{1,3}(?:[.,]\d{1,3})?\s*)?\b(?:ty|ti)\b""", RegexOption.IGNORE_CASE)

    // Unit and core price regexes
    // UNIT: trieu, tr, cu, m (not followed by a-z)
    private const val UNIT_PATTERN = """(?:trieu|tr|cu|m)(?![a-z])"""
    private val CORE_PRICE_REGEX = Regex(
        """(?<!\d)(\d{1,3}(?:[.,]\d{1,3})?)\s*$UNIT_PATTERN\s*(\d{1,2})?(?!\d)""",
        RegexOption.IGNORE_CASE
    )
    private val K_PRICE_REGEX = Regex(
        """(?<!\d)(\d{1,4}(?:[.,]\d{3})?|\d{3,5})\s*k(?![a-z])""",
        RegexOption.IGNORE_CASE
    )
    private val GIA_PREFIX_PRICE_REGEX = Regex(
        """(?:gia|gia\s*thue|thue)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d)?)(?!\d|\s*(?:tr|trieu|cu|m|k|ty|ti|m2|m²))""",
        RegexOption.IGNORE_CASE
    )

    // Range price regex: e.g. 3tr - 4tr5, 3 - 4tr5, 3-4tr5, 2tr5 - 3tr, 4tr2 - 4tr8
    private val RANGE_PRICE_REGEX = Regex(
        """(?<!\d)(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:tr|trieu|cu|m)?\s*(\d{1,2})?\s*[-–—/]\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*$UNIT_PATTERN\s*(\d{1,2})?(?!\d)""",
        RegexOption.IGNORE_CASE
    )

    private val SCORE_PREFIX_REGEX = Regex("""(?:gia|thue|chi|only)""", RegexOption.IGNORE_CASE)

    // Tier 1: Compound names / specific landmarks
    private val TIER1_DISTRICTS = listOf(
        // Landmarks / Special areas first
        Regex("""\bphu\s*my\s*hung\b""") to "Quận 7",
        Regex("""\blang\s*dai\s*hoc\b""") to "TP. Thủ Đức",
        Regex("""\bhutech\b""") to "Bình Thạnh",
        Regex("""\btp\.?\s*thu\s*duc\b""") to "TP. Thủ Đức",
        Regex("""\bthu\s*duc\b""") to "TP. Thủ Đức",
        Regex("""\bbinh\s*thanh\b""") to "Bình Thạnh",
        Regex("""\bphu\s*nhuan\b""") to "Phú Nhuận",
        Regex("""\bgo\s*vap\b""") to "Gò Vấp",
        Regex("""\btan\s*binh\b""") to "Tân Bình",
        Regex("""\btan\s*phu\b""") to "Tân Phú",
        Regex("""\bbinh\s*tan\b""") to "Bình Tân",
        Regex("""\bnha\s*be\b""") to "Nhà Bè",
        Regex("""\bbinh\s*chanh\b""") to "Bình Chánh",
        Regex("""\bhoc\s*mon\b""") to "Hóc Môn",
        Regex("""\bcu\s*chi\b""") to "Củ Chi",
        Regex("""\bcan\s*gio\b""") to "Cần Giờ",
        // Numbered districts (full word and abbreviations)
        Regex("""\b(?:quan|q\.?)\s*1\b""") to "Quận 1",
        Regex("""\b(?:quan|q\.?)\s*2\b""") to "TP. Thủ Đức", // Merged
        Regex("""\b(?:quan|q\.?)\s*3\b""") to "Quận 3",
        Regex("""\b(?:quan|q\.?)\s*4\b""") to "Quận 4",
        Regex("""\b(?:quan|q\.?)\s*5\b""") to "Quận 5",
        Regex("""\b(?:quan|q\.?)\s*6\b""") to "Quận 6",
        Regex("""\b(?:quan|q\.?)\s*7\b""") to "Quận 7",
        Regex("""\b(?:quan|q\.?)\s*8\b""") to "Quận 8",
        Regex("""\b(?:quan|q\.?)\s*9\b""") to "TP. Thủ Đức", // Merged
        Regex("""\b(?:quan|q\.?)\s*10\b""") to "Quận 10",
        Regex("""\b(?:quan|q\.?)\s*11\b""") to "Quận 11",
        Regex("""\b(?:quan|q\.?)\s*12\b""") to "Quận 12"
    )

    // Tier 2: 2-character short codes with word boundaries
    private val TIER2_DISTRICTS = listOf(
        Regex("""\bbt\b""") to "Bình Thạnh",
        Regex("""\bpn\b""") to "Phú Nhuận",
        Regex("""\bgv\b""") to "Gò Vấp",
        Regex("""\btb\b""") to "Tân Bình",
        Regex("""\btd\b""") to "TP. Thủ Đức"
    )

    private val MIN_PRICE = 1_000_000L
    private val MAX_PRICE = 100_000_000L

    fun parse(rawText: String): ParsedListing {
        val folded = rawText.fold1to1()
        val phones = extractPhones(rawText)
        val ownerPhone = phones.firstOrNull()

        val priceResult = extractPrice(rawText, folded)
        val area = extractArea(folded)
        val district = extractDistrict(folded)
        val roomType = extractRoomType(folded)
        val address = extractAddress(rawText, folded)

        val confidence = calculateConfidence(
            hasPrice = priceResult.priceMin != null,
            hasDistrict = district != null,
            hasRoomType = roomType != null,
            hasArea = area != null
        )

        return ParsedListing(
            roomType = roomType,
            district = district,
            address = address,
            areaM2 = area,
            priceMin = priceResult.priceMin,
            priceMax = priceResult.priceMax,
            ownerPhone = ownerPhone,
            commissionNote = null,
            parseConfidence = confidence
        )
    }

    fun extractPhones(text: String): List<String> {
        val matches = PHONE_REGEX.findAll(text)
        return matches.map { match ->
            val digits = match.value.filter { it.isDigit() }
            if (digits.startsWith("84")) {
                "0" + digits.substring(2)
            } else {
                digits
            }
        }.filter { it.length == 10 && it.startsWith("0") }.toList()
    }

    fun maskNoiseForPrice(folded: String): String {
        val chars = folded.toCharArray()

        // 1. Mask phones
        PHONE_REGEX.findAll(folded).forEach { match ->
            for (i in match.range) {
                chars[i] = '#'
            }
        }

        // 2. Mask areas like 26m2
        val foldedStrForArea = String(chars)
        AREA_REGEX.findAll(foldedStrForArea).forEach { match ->
            for (i in match.range) {
                chars[i] = '#'
            }
        }

        // 3. Mask billions (ty/ti) so house sales like "3ty5" don't get parsed
        val foldedStrForBillion = String(chars)
        BILLION_REGEX.findAll(foldedStrForBillion).forEach { match ->
            for (i in match.range) {
                chars[i] = '#'
            }
        }

        return String(chars)
    }

    private fun extractPrice(rawText: String, folded: String): PriceResult {
        val masked = maskNoiseForPrice(folded)

        // 1. First check range price
        val rangeMatch = RANGE_PRICE_REGEX.find(masked)
        if (rangeMatch != null) {
            val a1Str = rangeMatch.groupValues[1].replace(',', '.')
            val b1Str = rangeMatch.groupValues[2]
            val a2Str = rangeMatch.groupValues[3].replace(',', '.')
            val b2Str = rangeMatch.groupValues[4]

            val val1Base = a1Str.toDoubleOrNull() ?: 0.0
            val val1Frac = if (b1Str.isNotEmpty()) {
                val bInt = b1Str.toIntOrNull() ?: 0
                if (b1Str.length == 1) bInt / 10.0 else bInt / 100.0
            } else 0.0
            val val1Double = val1Base + val1Frac

            val val2Base = a2Str.toDoubleOrNull() ?: 0.0
            val val2Frac = if (b2Str.isNotEmpty()) {
                val bInt = b2Str.toIntOrNull() ?: 0
                if (b2Str.length == 1) bInt / 10.0 else bInt / 100.0
            } else 0.0
            val val2Double = val2Base + val2Frac

            val minP = (val1Double * 1_000_000).toLong()
            val maxP = (val2Double * 1_000_000).toLong()
            if (minP in MIN_PRICE..MAX_PRICE && maxP in MIN_PRICE..MAX_PRICE) {
                return PriceResult(minP, maxP)
            }
        }

        // Collect single price candidates with scores
        data class Candidate(val price: Long, val index: Int, val score: Int)
        val candidates = mutableListOf<Candidate>()

        // 2. Check CORE_PRICE_REGEX (explicit unit)
        CORE_PRICE_REGEX.findAll(masked).forEach { match ->
            val aStr = match.groupValues[1].replace(',', '.')
            val bStr = match.groupValues[2]

            val aNum = aStr.toDoubleOrNull() ?: 0.0
            val bFrac = if (bStr.isNotEmpty()) {
                val bInt = bStr.toIntOrNull() ?: 0
                if (bStr.length == 1) bInt / 10.0 else bInt / 100.0
            } else 0.0
            val doubleVal = aNum + bFrac

            val price = (doubleVal * 1_000_000).toLong()
            if (price in MIN_PRICE..MAX_PRICE) {
                val score = 10 + scoreIndex(masked, match.range.first)
                candidates.add(Candidate(price, match.range.first, score))
            }
        }

        // 3. Check K_PRICE_REGEX (e.g. 6500k, 6.500k, 3500k, 7.500k)
        K_PRICE_REGEX.findAll(masked).forEach { match ->
            val rawNum = match.groupValues[1].replace(".", "").replace(",", "")
            val numVal = rawNum.toLongOrNull()
            if (numVal != null) {
                val price = numVal * 1000
                if (price in MIN_PRICE..MAX_PRICE) {
                    val score = 10 + scoreIndex(masked, match.range.first)
                    candidates.add(Candidate(price, match.range.first, score))
                }
            }
        }

        // 4. Check GIA_PREFIX_PRICE_REGEX (only if no core/k candidates found)
        if (candidates.isEmpty()) {
            GIA_PREFIX_PRICE_REGEX.findAll(masked).forEach { match ->
                val numStr = match.groupValues[1].replace(',', '.')
                val num = numStr.toDoubleOrNull()
                if (num != null && num in 1.0..99.0) {
                    val price = (num * 1_000_000).toLong()
                    if (price in MIN_PRICE..MAX_PRICE) {
                        candidates.add(Candidate(price, match.range.first, 1))
                    }
                }
            }
        }

        if (candidates.isEmpty()) {
            return PriceResult(null, null)
        }

        // Sort by highest score, then earliest appearance
        val best = candidates.sortedWith(
            compareByDescending<Candidate> { it.score }.thenBy { it.index }
        ).first()

        return PriceResult(best.price, null)
    }

    private fun scoreIndex(text: String, index: Int): Int {
        val windowStart = (index - 25).coerceAtLeast(0)
        val prefix = text.substring(windowStart, index)
        return if (SCORE_PREFIX_REGEX.containsMatchIn(prefix)) 1 else 0
    }

    fun extractArea(folded: String): Double? {
        val match = AREA_REGEX.find(folded) ?: return null
        val numStr = match.groupValues[1].replace(',', '.')
        val area = numStr.toDoubleOrNull() ?: return null
        return if (area in 8.0..300.0) area else null
    }

    fun extractDistrict(folded: String): String? {
        // Tier 1: Compound names
        for ((regex, district) in TIER1_DISTRICTS) {
            if (regex.containsMatchIn(folded)) {
                return district
            }
        }

        // Tier 2: 2-character short codes
        for ((regex, district) in TIER2_DISTRICTS) {
            if (regex.containsMatchIn(folded)) {
                return district
            }
        }

        return null
    }

    fun extractRoomType(folded: String): RoomType? {
        // Priority order: TWO_PN > ONE_PN > DUPLEX > CCMN > STUDIO > OFFICETEL > PHONG_TRO

        // 1. TWO_PN
        if (Regex("""(?:2\s*pn|2\s*phong\s*ngu|2\s*p\s*ngu|2\s*phong)""").containsMatchIn(folded)) {
            return RoomType.TWO_PN
        }

        // 2. ONE_PN
        if (Regex("""(?:1\s*pn|1\s*phong\s*ngu|1\s*p\s*ngu|1\s*phong)""").containsMatchIn(folded)) {
            return RoomType.ONE_PN
        }

        // 3. DUPLEX (gác / lửng / duplex / mezzanine)
        if (Regex("""(?:gac|lung|duplex|mezzanine)""").containsMatchIn(folded)) {
            return RoomType.DUPLEX
        }

        // 4. CCMN (ccmn / chung cư mini / chung cư)
        if (Regex("""(?:ccmn|chung\s*cu\s*mini|chung\s*cu)""").containsMatchIn(folded)) {
            return RoomType.CCMN
        }

        // 5. STUDIO (ban công / stu / studio)
        if (Regex("""(?:ban\s*cong|\bstu\b|studio)""").containsMatchIn(folded)) {
            return RoomType.STUDIO
        }

        // 6. OFFICETEL (officetel / office)
        if (Regex("""(?:officetel|\boffice\b)""").containsMatchIn(folded)) {
            return RoomType.OFFICETEL
        }

        // 7. PHONG_TRO (phong tro / nha tro / phong)
        if (Regex("""(?:phong\s*tro|nha\s*tro|\bphong\b)""").containsMatchIn(folded)) {
            return RoomType.PHONG_TRO
        }

        return null
    }

    fun extractAddress(rawText: String, folded: String): String? {
        val lines = rawText.lines()
        for (line in lines) {
            val foldedLine = line.fold1to1()
            val match = Regex("""(?:dia\s*chi|dc|d\/c|location|vi\s*tri)\s*[:\-]\s*([^\n]+)""", RegexOption.IGNORE_CASE).find(foldedLine)
            if (match != null) {
                val startInFolded = match.groups[1]?.range?.first ?: continue
                var extracted = line.substring(startInFolded).trim()
                // Cut off at separators, emojis, or subsequent field keywords
                val cutRegex = Regex("""(?:💰|📐|🛋|✨|🔥|📞|📲|📍|\bgia\b|\bdien\s*tich\b|\bdt\b|\bsdt\b|\blh\b|\blien\s*he\b|\bphone\b|\bcall\b)""", RegexOption.IGNORE_CASE)
                val cutMatch = cutRegex.find(extracted.fold1to1())
                if (cutMatch != null) {
                    extracted = extracted.substring(0, cutMatch.range.first).trim()
                }
                extracted = PHONE_REGEX.replace(extracted, "").trim()
                extracted = extracted.trimEnd(',', '.', '-', ':', ';')
                if (extracted.length in 4..100) return extracted
            }
            if (Regex("""\b(?:duong|hem|mat\s*tien|so\s*\d+)\b""").containsMatchIn(foldedLine)) {
                var trimmed = line.trim()
                trimmed = PHONE_REGEX.replace(trimmed, "").trim()
                if (trimmed.length in 5..80) {
                    return trimmed
                }
            }
        }
        return null
    }

    fun calculateConfidence(
        hasPrice: Boolean,
        hasDistrict: Boolean,
        hasRoomType: Boolean,
        hasArea: Boolean
    ): Float {
        var score = 0f
        if (hasPrice) score += 0.4f
        if (hasDistrict) score += 0.25f
        if (hasRoomType) score += 0.2f
        if (hasArea) score += 0.15f
        return Math.round(score * 100f) / 100f
    }
}
