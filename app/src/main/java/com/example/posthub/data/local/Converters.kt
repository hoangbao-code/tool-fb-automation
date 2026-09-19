package com.example.posthub.data.local

import androidx.room.TypeConverter
import com.example.posthub.domain.model.IfMissingPolicy
import com.example.posthub.domain.model.JoinStatus
import com.example.posthub.domain.model.PostSource
import com.example.posthub.domain.model.PostStatus
import com.example.posthub.domain.model.TemplateSelectionMode
import org.json.JSONArray

class Converters {
    @TypeConverter
    fun fromStringList(list: List<String>?): String {
        if (list == null) return "[]"
        val array = JSONArray()
        list.forEach { array.put(it) }
        return array.toString()
    }

    @TypeConverter
    fun toStringList(data: String?): List<String> {
        if (data.isNullOrBlank()) return emptyList()
        return try {
            val array = JSONArray(data)
            val list = mutableListOf<String>()
            for (i in 0 until array.length()) {
                list.add(array.getString(i))
            }
            list
        } catch (e: Exception) {
            emptyList()
        }
    }

    @TypeConverter
    fun fromLongList(list: List<Long>?): String {
        if (list == null) return "[]"
        val array = JSONArray()
        list.forEach { array.put(it) }
        return array.toString()
    }

    @TypeConverter
    fun toLongList(data: String?): List<Long> {
        if (data.isNullOrBlank()) return emptyList()
        return try {
            val array = JSONArray(data)
            val list = mutableListOf<Long>()
            for (i in 0 until array.length()) {
                list.add(array.getLong(i))
            }
            list
        } catch (e: Exception) {
            emptyList()
        }
    }

    @TypeConverter
    fun fromPostStatus(status: PostStatus): String = status.name

    @TypeConverter
    fun toPostStatus(value: String): PostStatus = try {
        PostStatus.valueOf(value)
    } catch (e: Exception) {
        PostStatus.PENDING_REVIEW
    }

    @TypeConverter
    fun fromPostSource(source: PostSource): String = source.name

    @TypeConverter
    fun toPostSource(value: String): PostSource = try {
        PostSource.valueOf(value)
    } catch (e: Exception) {
        PostSource.MANUAL
    }

    @TypeConverter
    fun fromIfMissingPolicy(policy: IfMissingPolicy): String = policy.name

    @TypeConverter
    fun toIfMissingPolicy(value: String): IfMissingPolicy = try {
        IfMissingPolicy.valueOf(value)
    } catch (e: Exception) {
        IfMissingPolicy.SKIP_LINE
    }

    @TypeConverter
    fun fromTemplateSelectionMode(mode: TemplateSelectionMode): String = mode.name

    @TypeConverter
    fun toTemplateSelectionMode(value: String): TemplateSelectionMode = try {
        TemplateSelectionMode.valueOf(value)
    } catch (e: Exception) {
        TemplateSelectionMode.MANUAL
    }

    @TypeConverter
    fun fromJoinStatus(status: JoinStatus): String = status.name

    @TypeConverter
    fun toJoinStatus(value: String): JoinStatus = try {
        JoinStatus.valueOf(value)
    } catch (e: Exception) {
        JoinStatus.NOT_JOINED
    }
}
