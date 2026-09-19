package com.example.posthub.domain

import com.example.posthub.fb.DiscoveredGroup
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GroupAutomationTest {

    @Test
    fun testParseDiscoveredGroupsJson() {
        val sampleJson = """
            [
                {"name": "Hội Cho Thuê Phòng Trọ Bình Thạnh", "url": "https://m.facebook.com/groups/binhthanhrooms", "isJoined": true},
                {"name": "Căn Hộ Dịch Vụ Sài Gòn Giá Rẻ", "url": "https://m.facebook.com/groups/chdvsaigon", "isJoined": false}
            ]
        """.trimIndent()

        val jsonArray = JSONArray(sampleJson)
        val list = mutableListOf<DiscoveredGroup>()
        for (i in 0 until jsonArray.length()) {
            val item = jsonArray.getJSONObject(i)
            list.add(
                DiscoveredGroup(
                    name = item.getString("name"),
                    url = item.getString("url"),
                    isJoined = item.getBoolean("isJoined")
                )
            )
        }

        assertEquals(2, list.size)
        assertEquals("Hội Cho Thuê Phòng Trọ Bình Thạnh", list[0].name)
        assertTrue(list[0].isJoined)
        assertEquals("https://m.facebook.com/groups/chdvsaigon", list[1].url)
        assertTrue(!list[1].isJoined)
    }
}
