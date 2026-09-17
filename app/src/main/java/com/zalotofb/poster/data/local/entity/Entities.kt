package com.zalotofb.poster.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.zalotofb.poster.domain.model.ListingStatus
import com.zalotofb.poster.domain.model.RoomType
import com.zalotofb.poster.domain.model.Source

@Entity(
    tableName = "listings",
    indices = [
        Index(value = ["contentHash"]),
        Index(value = ["status"]),
        Index(value = ["district"])
    ]
)
data class ListingEntity(
    @PrimaryKey val id: String,
    val rawText: String,
    val cleanText: String,
    val renderedText: String,
    val source: Source,
    val sourceGroup: String?,
    val contentHash: String,
    val priceMin: Long?,
    val priceMax: Long?,
    val areaM2: Double?,
    val district: String?,
    val roomType: RoomType?,
    val address: String?,
    val status: ListingStatus,
    val ownerPhone: String?,
    val commissionNote: String?,
    val parseConfidence: Float,
    val createdAt: Long,
    val updatedAt: Long
)

@Entity(
    tableName = "listing_photos",
    foreignKeys = [
        ForeignKey(
            entity = ListingEntity::class,
            parentColumns = ["id"],
            childColumns = ["listingId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index(value = ["listingId"])]
)
data class ListingPhotoEntity(
    @PrimaryKey val id: String,
    val listingId: String,
    val uri: String,
    val order: Int,
    val isCover: Boolean
)

@Entity(
    tableName = "fb_groups",
    indices = [Index(value = ["url"], unique = true)]
)
data class FbGroupEntity(
    @PrimaryKey val id: String,
    val name: String,
    val url: String,
    val districtTag: String?,
    val trackingCode: String,
    val postLimitPerDay: Int = 1,
    val isActive: Boolean = true
)

@Entity(
    tableName = "post_logs",
    indices = [
        Index(value = ["listingId"]),
        Index(value = ["groupId"]),
        Index(value = ["postedAt"])
    ]
)
data class PostLogEntity(
    @PrimaryKey val id: String,
    val listingId: String,
    val groupId: String,
    val postedAt: Long,
    val fbPostUrl: String?,
    val variantIndex: Int
)

@Entity(
    tableName = "leads",
    indices = [
        Index(value = ["phone"]),
        Index(value = ["listingId"]),
        Index(value = ["groupId"]),
        Index(value = ["createdAt"])
    ]
)
data class LeadEntity(
    @PrimaryKey val id: String,
    val phone: String,
    val listingId: String?,
    val groupId: String?,
    val note: String?,
    val createdAt: Long
)
