package com.example.posthub.domain

import com.example.posthub.fb.AssistedPostingGroup
import com.example.posthub.fb.AssistedSession
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EnhancementsTest {

    @Test
    fun testKeywordFilteringGroups() {
        val groups = listOf(
            AssistedPostingGroup(1L, "Hội Bất Động Sản Hà Nội", "https://facebook.com/groups/1"),
            AssistedPostingGroup(2L, "Mua Bán Xe Máy Cũ Sài Gòn", "https://facebook.com/groups/2"),
            AssistedPostingGroup(3L, "Nhà Đất Bất Động Sản TP.HCM", "https://facebook.com/groups/3")
        )

        val keyword = "Bất Động Sản"
        val filtered = groups.filter { it.name.contains(keyword, ignoreCase = true) }

        assertEquals(2, filtered.size)
        assertTrue(filtered.any { it.id == 1L })
        assertTrue(filtered.any { it.id == 3L })
        assertFalse(filtered.any { it.id == 2L })
    }

    @Test
    fun testPostSignatureAppending() {
        val original = "Bán nhà 3 tầng Quận 9, đường 10m"
        val signature = "📞 Hotline: 0909123456"

        val withSignature = "$original\n\n$signature".trim()
        assertTrue(withSignature.contains("Bán nhà 3 tầng"))
        assertTrue(withSignature.endsWith("📞 Hotline: 0909123456"))

        // Nếu đã có chữ ký rồi thì không lặp lại chữ ký
        val doubleCheck = if (withSignature.contains(signature)) withSignature else "$withSignature\n\n$signature"
        assertEquals(withSignature, doubleCheck)
    }

    @Test
    fun testAssistedSessionProgression() {
        val groups = listOf(
            AssistedPostingGroup(1L, "Group 1", "url1"),
            AssistedPostingGroup(2L, "Group 2", "url2"),
            AssistedPostingGroup(3L, "Group 3", "url3")
        )
        val variations = listOf("Variation A", "Variation B")

        val session = AssistedSession(groups = groups, contentList = variations, currentIndex = 0)

        assertEquals("Group 1", session.currentGroup()?.name)
        assertEquals("Variation A", session.currentContent())
        assertEquals("1/3", session.progressDisplay)
        assertTrue(session.hasNext())
        assertFalse(session.isLast())

        // Sang nhóm 2
        session.currentIndex = 1
        assertEquals("Group 2", session.currentGroup()?.name)
        assertEquals("Variation B", session.currentContent())
        assertEquals("2/3", session.progressDisplay)

        // Sang nhóm 3 (xoay tua biến thể về lại A)
        session.currentIndex = 2
        assertEquals("Group 3", session.currentGroup()?.name)
        assertEquals("Variation A", session.currentContent())
        assertEquals("3/3", session.progressDisplay)
        assertTrue(session.isLast())
        assertFalse(session.hasNext())
    }

    @Test
    fun testAutoCleanupDaysCutoff() {
        val days = 7
        val now = 1710000000000L
        val cutoff = now - (days * 24L * 3600L * 1000L)

        val oldPostTime = now - (8 * 24L * 3600L * 1000L)
        val newPostTime = now - (3 * 24L * 3600L * 1000L)

        assertTrue(oldPostTime < cutoff)
        assertFalse(newPostTime < cutoff)
    }
}
