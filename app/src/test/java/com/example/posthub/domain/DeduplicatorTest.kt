package com.example.posthub.domain

import com.example.posthub.domain.dedup.Deduplicator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeduplicatorTest {

    @Test
    fun testSimHashIdenticalText() {
        val text1 = "Cho thuê phòng trọ quận Bình Thạnh giá 5 triệu đầy đủ tiện nghi"
        val text2 = "Cho thuê phòng trọ quận Bình Thạnh giá 5 triệu đầy đủ tiện nghi"

        val hash1 = Deduplicator.computeSimHash(text1)
        val hash2 = Deduplicator.computeSimHash(text2)

        assertEquals("Hai chuỗi giống nhau phải có SimHash bằng nhau", hash1, hash2)
        assertEquals("Khoảng cách Hamming phải bằng 0", 0, Deduplicator.hammingDistance(hash1, hash2))
        assertTrue("Phải là bản sao trùng lặp", Deduplicator.isNearDuplicateText(hash1, hash2))
    }

    @Test
    fun testSimHashNearDuplicateText() {
        val text1 = "Cho thuê phòng trọ quận Bình Thạnh giá 5 triệu đầy đủ tiện nghi ban công thoáng mát"
        val text2 = "Cho thuê phòng trọ quận Bình Thạnh giá 5 triệu đầy đủ tiện nghi ban công rất thoáng mát"

        val hash1 = Deduplicator.computeSimHash(text1)
        val hash2 = Deduplicator.computeSimHash(text2)

        val distance = Deduplicator.hammingDistance(hash1, hash2)
        assertTrue("Khoảng cách hai chuỗi gần giống nhau phải nhỏ (<= 4)", distance <= 4)
        assertTrue("Phải phát hiện gần trùng lặp", Deduplicator.isNearDuplicateText(hash1, hash2))
    }

    @Test
    fun testSimHashDifferentText() {
        val text1 = "Cho thuê phòng trọ quận Bình Thạnh giá 5 triệu đầy đủ tiện nghi"
        val text2 = "Bán xe máy Honda Wave Alpha màu đỏ chính chủ biển số thành phố"

        val hash1 = Deduplicator.computeSimHash(text1)
        val hash2 = Deduplicator.computeSimHash(text2)

        val distance = Deduplicator.hammingDistance(hash1, hash2)
        assertTrue("Khoảng cách hai chuỗi khác biệt phải lớn (> 10)", distance > 10)
        assertFalse("Không được báo trùng lặp", Deduplicator.isNearDuplicateText(hash1, hash2))
    }
}
