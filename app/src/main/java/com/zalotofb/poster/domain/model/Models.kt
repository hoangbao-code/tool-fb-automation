package com.zalotofb.poster.domain.model

enum class RoomType(val displayName: String, val priority: Int) {
    TWO_PN("2 Phòng Ngủ", 1),
    ONE_PN("1 Phòng Ngủ", 2),
    DUPLEX("Duplex Gác Lửng", 3),
    CCMN("Chung Cư Mini", 4),
    STUDIO("Studio Ban Công", 5),
    OFFICETEL("Officetel", 6),
    PHONG_TRO("Phòng Trọ", 7)
}

enum class ListingStatus {
    DRAFT, READY, LISTED, RENTED, EXPIRED
}

enum class Source {
    ZALO_NOTIFICATION, PASTE, SHARE_INTENT, MANUAL
}

data class PriceResult(
    val priceMin: Long?,
    val priceMax: Long?
)

data class RemovedSpan(
    val start: Int,
    val end: Int,
    val originalText: String,
    val reason: String
)

data class ScrubResult(
    val cleanText: String,
    val ownerPhone: String?,
    val commissionNote: String?,
    val removedSpans: List<RemovedSpan>
)

data class ParsedListing(
    val roomType: RoomType?,
    val district: String?,
    val address: String?,
    val areaM2: Double?,
    val priceMin: Long?,
    val priceMax: Long?,
    val ownerPhone: String?,
    val commissionNote: String?,
    val parseConfidence: Float
)
