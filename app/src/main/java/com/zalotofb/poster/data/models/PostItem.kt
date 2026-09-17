package com.zalotofb.poster.data.models

import java.io.Serializable
import java.util.UUID

enum class PostStatus {
    PENDING,    // Chờ duyệt (Bán tự động)
    QUEUED,     // Đã duyệt, đang trong hàng đợi chờ đăng
    POSTING,    // Đang trong tiến trình đăng
    POSTED,     // Đã đăng thành công lên FB
    FAILED      // Đăng thất bại / lỗi
}

data class PostItem(
    val id: String = UUID.randomUUID().toString(),
    val zaloGroupName: String = "",
    val senderName: String = "",
    var originalContent: String = "",
    var processedContent: String = "",
    var roomType: String = "Studio",
    var district: String = "Trung Tâm",
    var price: String = "Thỏa thuận",
    val imageUris: MutableList<String> = mutableListOf(),
    val createdAt: Long = System.currentTimeMillis(),
    var status: PostStatus = PostStatus.PENDING,
    var targetGroupIds: MutableList<String> = mutableListOf(),
    var scheduledTime: Long = 0L,
    var errorLog: String? = null,
    var fbPostUrl: String? = null
) : Serializable
