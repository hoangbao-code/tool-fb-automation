package com.example.posthub.domain

import com.example.posthub.fb.DiscoveredGroup
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GroupAutomationTest {

    @Test
    fun testDiscoveredGroupModelAndUrlCleaning() {
        val rawUrl = "https://www.facebook.com/groups/binhthanhrooms/?ref=share&mibextid=NSMWBT"
        val cleanUrl = rawUrl.replace("www.facebook.com", "m.facebook.com").substringBefore("?")
        assertEquals("https://m.facebook.com/groups/binhthanhrooms", cleanUrl)

        val group = DiscoveredGroup(
            name = "Hội Cho Thuê Phòng Trọ Bình Thạnh",
            url = cleanUrl,
            isJoined = true
        )
        assertEquals("Hội Cho Thuê Phòng Trọ Bình Thạnh", group.name)
        assertEquals("https://m.facebook.com/groups/binhthanhrooms", group.url)
        assertTrue(group.isJoined)
    }

    @Test
    fun testFilterUnjoinedGroups() {
        val groups = listOf(
            DiscoveredGroup("Nhóm 1", "https://m.facebook.com/groups/1", isJoined = true),
            DiscoveredGroup("Nhóm 2", "https://m.facebook.com/groups/2", isJoined = false),
            DiscoveredGroup("Nhóm 3", "https://m.facebook.com/groups/3", isJoined = false)
        )
        val unjoined = groups.filter { !it.isJoined }
        assertEquals(2, unjoined.size)
        assertEquals("Nhóm 2", unjoined[0].name)
        assertEquals("Nhóm 3", unjoined[1].name)
        assertFalse(unjoined[0].isJoined)
    }

    @Test
    fun testAnswerPoolDefaults() {
        val defaultAnswers = listOf(
            "Tôi đồng ý với tất cả nội quy của nhóm.",
            "Tôi là thành viên chính chủ, tìm phòng và đăng tin nghiêm túc.",
            "Đồng ý.",
            "0901234567"
        )
        assertTrue(defaultAnswers.isNotEmpty())
        assertTrue(defaultAnswers.any { it.contains("đồng ý", ignoreCase = true) })
    }
}

