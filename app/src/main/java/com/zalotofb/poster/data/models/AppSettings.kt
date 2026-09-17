package com.zalotofb.poster.data.models

import java.io.Serializable

data class AppSettings(
    var isAutoMode: Boolean = false,              // false: Bán tự động, true: Tự động 100%
    var monitoredZaloGroups: String = "",         // Tên các nhóm Zalo chủ nhà/sale cần lấy tin
    var replacementPhone: String = "",            // Hotline môi giới của bạn
    var brokerName: String = "Chuyên Căn Hộ Dịch Vụ",
    var signatureText: String = "☎️ Hotline/Zalo: 0988.888.888 (Tư vấn & dẫn xem phòng miễn phí 24/7!)",
    var antiBanDelaySeconds: Int = 180,           // Giãn cách an toàn giữa các nhóm (120s - 240s)
    var batchGroupTimeoutSeconds: Int = 15,       // Gom ảnh gửi dồn dập thành 1 album phòng
    var isFloatingBubbleEnabled: Boolean = true,  // Bật bong bóng nổi khi có phòng mới
    var aiPromptTemplate: String = """
🔥 [TIÊU ĐỀ GIẬT TÍT & LOẠI PHÒNG] 🔥

📍 Vị trí: [Đường, Quận - Thuận tiện di chuyển]
💰 Giá thuê: [Giá thuê / tháng]

✨ TIỆN NGHI CĂN HỘ (Full nội thất cao cấp):
- Máy lạnh, tủ lạnh, máy giặt, giường nệm cao cấp.
- Tủ quần áo lớn, bàn làm việc, kệ bếp riêng nấu ăn.

🏢 TIỆN ÍCH TÒA NHÀ:
- Khóa cổng vân tay, camera an ninh 24/7.
- Giờ giấc tự do 100%, không chung chủ.
- Thang máy, bãi để xe rộng rãi.
- Cho nuôi thú cưng (Pet-friendly) 🐶🐱.

☎️ LIÊN HỆ XEM PHÒNG TRỰC TIẾP:
[HOTLINE_VA_CHUKY]

#chothuecanho #canhodichvu #chdv #phongtro #chothue
""".trimIndent()
) : Serializable
