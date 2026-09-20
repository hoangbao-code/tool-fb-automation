package com.example.posthub.domain

import com.example.posthub.domain.ai.AiService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AiServiceTest {

    private lateinit var aiService: AiService

    @Before
    fun setup() {
        aiService = AiService()
    }

    @Test
    fun testBuildPrompt_withPlaceholders() {
        val template = "Nhóm: {GROUP} - Người gửi: {SENDER}\nNội dung:\n{CONTENT}\nViết lại hấp dẫn."
        val content = "Căn hộ 2PN 8 triệu Q.Bình Thạnh"
        val group = "Cộng Đồng Môi Giới"

        val prompt = aiService.buildPrompt(template, content, group)

        assertTrue(prompt.contains("Nhóm: Cộng Đồng Môi Giới"))
        assertTrue(prompt.contains("Người gửi: Cộng Đồng Môi Giới"))
        assertTrue(prompt.contains("Căn hộ 2PN 8 triệu Q.Bình Thạnh"))
    }

    @Test
    fun testBuildPrompt_withoutContentPlaceholder_appendsAtBottom() {
        val template = "Hãy viết lại tin nhắn này theo phong cách bán hàng:"
        val content = "Bán nhà hẻm xe hơi 5 tỷ"
        val group = "BĐS Gò Vấp"

        val prompt = aiService.buildPrompt(template, content, group)

        assertTrue(prompt.startsWith("Hãy viết lại tin nhắn này theo phong cách bán hàng:"))
        assertTrue(prompt.contains("Nội dung cần viết lại:"))
        assertTrue(prompt.contains("Bán nhà hẻm xe hơi 5 tỷ"))
    }

    @Test
    fun testParseGeminiResponse_validJson() {
        val json = """
            {
              "candidates": [
                {
                  "content": {
                    "parts": [
                      {
                        "text": "🔥 SIÊU PHẨM CĂN HỘ QUẬN BÌNH THẠNH 🔥\nGiá: 8tr/tháng\nLH: 0901234567"
                      }
                    ]
                  }
                }
              ]
            }
        """.trimIndent()

        val parsed = aiService.parseGeminiResponse(json)
        assertEquals("🔥 SIÊU PHẨM CĂN HỘ QUẬN BÌNH THẠNH 🔥\nGiá: 8tr/tháng\nLH: 0901234567", parsed)
    }

    @Test(expected = Exception::class)
    fun testParseGeminiResponse_emptyCandidates_throwsException() {
        val json = """
            {
              "candidates": []
            }
        """.trimIndent()

        aiService.parseGeminiResponse(json)
    }
}
