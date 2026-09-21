package com.example.posthub.scanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GroupScannerTest {

    @Test
    fun testSuggestionHelperArea() {
        val nameHn = "Hội Cư Dân Chung Cư Cầu Giấy Hà Nội"
        assertEquals("Hà Nội", SuggestionHelper.suggestArea(nameHn))

        val nameSg = "Cho thuê căn hộ dịch vụ Quận 7 Sài Gòn"
        assertEquals("TP.HCM", SuggestionHelper.suggestArea(nameSg))

        val nameDn = "Giao lưu việc làm Sơn Trà Đà Nẵng"
        assertEquals("Đà Nẵng", SuggestionHelper.suggestArea(nameDn))
    }

    @Test
    fun testSuggestionHelperCategory() {
        val nameBds = "Chợ Nhà Đất & BĐS Giá Tốt 2026"
        assertEquals("Bất Động Sản", SuggestionHelper.suggestCategory(nameBds))

        val nameViecLam = "Cộng đồng tìm việc làm và tuyển dụng part-time"
        assertEquals("Việc Làm", SuggestionHelper.suggestCategory(nameViecLam))

        val nameThanhLy = "Hội thanh lý đồ cũ pass đồ sinh viên"
        assertEquals("Thanh Lý / Mua Bán", SuggestionHelper.suggestCategory(nameThanhLy))
    }

    @Test
    fun testScannerConfigJsonParsing() {
        val sampleJson = """
            {
              "facebook": {
                "primaryUrl": "https://m.facebook.com/groups/?category=membership",
                "fallbackUrl": "https://www.facebook.com/groups/joins/",
                "checkpointIndicatorSelectors": ["#checkpointSubmitButton"],
                "groupItemLinkSelector": "a[href*='/groups/']",
                "excludedPathIds": ["feed", "discover"]
              },
              "zalo": {
                "url": "https://chat.zalo.me",
                "qrLoginSelector": "#qr-container",
                "virtualListSelector": "#conversationList"
              },
              "safety": {
                "minDelayMs": 1500,
                "maxDelayMs": 3500,
                "maxFbGroups": 300,
                "maxConsecutiveStallCount": 3
              }
            }
        """.trimIndent()

        val parsed = FullScannerConfig.parse(sampleJson)
        assertNotNull(parsed)
        assertEquals("https://m.facebook.com/groups/?category=membership", parsed.facebook.primaryUrl)
        assertEquals("https://chat.zalo.me", parsed.zalo.url)
        assertEquals(300, parsed.safety.maxFbGroups)
        assertEquals(3, parsed.safety.maxConsecutiveStallCount)
        assertTrue(parsed.facebook.excludedPathIds.contains("feed"))
    }
}
