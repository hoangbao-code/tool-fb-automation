package com.example.posthub.domain

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ZaloFilterTest {

    private fun isGroupMonitored(groupName: String, monitoredGroups: Set<String>): Boolean {
        if (monitoredGroups.isEmpty()) return false
        val clean = groupName.trim().lowercase()
        return monitoredGroups.any {
            val monitoredClean = it.trim().lowercase()
            monitoredClean == clean || clean.contains(monitoredClean) || monitoredClean.contains(clean)
        }
    }

    @Test
    fun testIsGroupMonitored_exactMatch() {
        val monitored = setOf("Cộng Đồng BĐS Sài Gòn", "Phòng Trọ Bình Thạnh")

        assertTrue(isGroupMonitored("Cộng Đồng BĐS Sài Gòn", monitored))
        assertTrue(isGroupMonitored("cộng đồng bđs sài gòn", monitored))
        assertTrue(isGroupMonitored("Phòng Trọ Bình Thạnh", monitored))
    }

    @Test
    fun testIsGroupMonitored_substringMatch() {
        val monitored = setOf("Bình Thạnh", "Quận 1")

        // Khi Zalo có icon hoặc thêm chữ phụ
        assertTrue(isGroupMonitored("🔥 Nhóm Phòng Trọ Bình Thạnh Giá Rẻ", monitored))
        assertTrue(isGroupMonitored("Căn Hộ Quận 1 Cao Cấp", monitored))
        assertFalse(isGroupMonitored("Căn Hộ Quận 7", monitored))
    }

    @Test
    fun testIsGroupMonitored_emptyList_rejectsAll() {
        val monitored = emptySet<String>()

        assertFalse(isGroupMonitored("Bất kỳ nhóm nào", monitored))
        assertFalse(isGroupMonitored("Zalo", monitored))
    }
}
