package com.example.posthub.domain

import com.example.posthub.fb.FbPostResult
import com.example.posthub.fb.SelectorConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FbPosterTest {

    @Test
    fun testSelectorConfigNoInvalidHasText() {
        val config = SelectorConfig.DEFAULT
        assertFalse("composerOpenButton không được chứa :has-text", config.composerOpenButton.contains(":has-text"))
        assertFalse("composerSubmitButton không được chứa :has-text", config.composerSubmitButton.contains(":has-text"))
        assertFalse("groupJoinButton không được chứa :has-text", config.groupJoinButton.contains(":has-text"))
        assertFalse("joinSubmitButton không được chứa :has-text", config.joinSubmitButton.contains(":has-text"))
    }

    @Test
    fun testFbPostResultSuccessAndPendingDistinction() {
        val successResult = FbPostResult(
            status = "SUCCESS",
            postUrl = "https://m.facebook.com/groups/12345/posts/999888777/",
            message = "Đăng thành công"
        )
        assertEquals("SUCCESS", successResult.status)
        assertNotNull(successResult.postUrl)
        assertTrue(successResult.postUrl!!.contains("/posts/"))

        val pendingResult = FbPostResult(
            status = "PENDING_APPROVAL",
            postUrl = "https://m.facebook.com/groups/12345/pending_posts",
            message = "Đang chờ Quản trị viên duyệt"
        )
        assertEquals("PENDING_APPROVAL", pendingResult.status)
        assertEquals("Đang chờ Quản trị viên duyệt", pendingResult.message)

        val failedResult = FbPostResult(
            status = "FAILED",
            error = "Tài khoản đang bị Facebook tạm khóa tính năng đăng bài trong nhóm."
        )
        assertEquals("FAILED", failedResult.status)
        assertTrue(failedResult.error!!.contains("tạm khóa"))
    }

    @Test
    fun testReportFormatting() {
        val results = listOf(
            Triple("Nhóm BĐS Quận 1", "SUCCESS", "https://facebook.com/groups/1/posts/100"),
            Triple("Nhóm Cho Thuê Bình Thạnh", "PENDING_APPROVAL", "Chờ duyệt"),
            Triple("Nhóm Gò Vấp", "FAILED", "Chưa tham gia nhóm")
        )

        val lines = mutableListOf<String>()
        results.forEachIndexed { index, (group, status, detail) ->
            val icon = when (status) {
                "SUCCESS" -> "✓ [ĐÃ ĐĂNG]"
                "PENDING_APPROVAL" -> "⏳ [CHỜ DUYỆT]"
                else -> "✗ [THẤT BẠI]"
            }
            lines.add("${index + 1}. $icon $group -> $detail")
        }

        val report = lines.joinToString("\n")
        assertTrue(report.contains("✓ [ĐÃ ĐĂNG] Nhóm BĐS Quận 1"))
        assertTrue(report.contains("⏳ [CHỜ DUYỆT] Nhóm Cho Thuê Bình Thạnh"))
        assertTrue(report.contains("✗ [THẤT BẠI] Nhóm Gò Vấp"))
    }
}
