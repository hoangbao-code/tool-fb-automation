package com.zalotofb.poster.data.local

import androidx.room.TypeConverter
import com.zalotofb.poster.domain.model.ListingStatus
import com.zalotofb.poster.domain.model.RoomType
import com.zalotofb.poster.domain.model.Source

class Converters {
    @TypeConverter
    fun fromRoomType(value: RoomType?): String? = value?.name

    @TypeConverter
    fun toRoomType(value: String?): RoomType? = value?.let {
        try { RoomType.valueOf(it) } catch (e: Exception) { null }
    }

    @TypeConverter
    fun fromListingStatus(value: ListingStatus): String = value.name

    @TypeConverter
    fun toListingStatus(value: String): ListingStatus =
        try { ListingStatus.valueOf(value) } catch (e: Exception) { ListingStatus.DRAFT }

    @TypeConverter
    fun fromSource(value: Source): String = value.name

    @TypeConverter
    fun toSource(value: String): Source =
        try { Source.valueOf(value) } catch (e: Exception) { Source.MANUAL }
}
