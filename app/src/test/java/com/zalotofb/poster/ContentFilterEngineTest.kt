package com.zalotofb.poster

import com.zalotofb.poster.data.models.AppSettings
import com.zalotofb.poster.engine.ContentFilterEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentFilterEngineTest {

    @Test
    fun testPhoneNumberReplacement() {
        val settings = AppSettings(
            replacementPhone = "0988888888",
            signatureText = "☎️ Hotline: 0988888888"
        )

        val original = "Áo khoác gió unisex xả kho giá 150k. Liên hệ sđt 0912345678 hoặc 0398765432 để chốt đơn ngay!"
        val processed = ContentFilterEngine.processContent(original, settings)

        assertTrue(processed.contains("0988888888"))
        assertTrue(!processed.contains("0912345678"))
        assertTrue(!processed.contains("0398765432"))
        assertTrue(processed.contains("Hotline: 0988888888"))
    }

    @Test
    fun testZaloLinkRemoval() {
        val settings = AppSettings()
        val original = "Tham gia nhóm sỉ tại https://zalo.me/g/abcdef123 để nhận bảng giá sỉ mới nhất!"
        val processed = ContentFilterEngine.processContent(original, settings)

        assertTrue(!processed.contains("https://zalo.me/g/abcdef123"))
    }

    @Test
    fun testGroupMonitoringFilter() {
        val settings = AppSettings(
            monitoredZaloGroups = "Sỉ Quần Áo, Kho Tổng Miền Bắc"
        )

        assertTrue(ContentFilterEngine.isGroupMonitored("Kho Sỉ Quần Áo VNXK", settings))
        assertTrue(ContentFilterEngine.isGroupMonitored("Kho Tổng Miền Bắc Tuyển Đại Lý", settings))
        assertTrue(!ContentFilterEngine.isGroupMonitored("Nhóm Bạn Bè Cấp 3", settings))
    }
}
