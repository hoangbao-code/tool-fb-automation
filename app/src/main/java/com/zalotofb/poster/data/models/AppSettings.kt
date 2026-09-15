package com.zalotofb.poster.data.models

import java.io.Serializable

data class AppSettings(
    var isAutoMode: Boolean = false,              // false: Bán tự động, true: Tự động 100%
    var monitoredZaloGroups: String = "",         // Tên các nhóm Zalo cần lọc, cách nhau bằng dấu phẩy. Trống = tất cả
    var replacementPhone: String = "",            // Số điện thoại thay thế
    var signatureText: String = "",               // Chữ ký/lời kết bài viết
    var antiBanDelaySeconds: Int = 180,           // Giãn cách ngẫu nhiên an toàn giữa các bài/nhóm (giây)
    var batchGroupTimeoutSeconds: Int = 15,       // Gom các ảnh gửi trong vòng X giây thành 1 bài
    var isFloatingBubbleEnabled: Boolean = true,  // Bật bong bóng nổi khi ở chế độ Bán tự động
    var minContentLength: Int = 5                 // Bỏ qua tin nhắn quá ngắn (dưới 5 ký tự)
) : Serializable
