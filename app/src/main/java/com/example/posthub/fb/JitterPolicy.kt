package com.example.posthub.fb

import java.util.Calendar
import kotlin.random.Random

object JitterPolicy {

    /**
     * Sinh độ trễ giả lập thao tác người (miligiây) giữa các thao tác bấm chuột/gõ chữ.
     * Mặc định từ 5 giây đến 15 giây.
     */
    fun calculateActionDelayMillis(minSec: Int = 5, maxSec: Int = 15): Long {
        val min = Math.min(minSec, maxSec).coerceAtLeast(1)
        val max = Math.max(minSec, maxSec).coerceAtLeast(min)
        val delaySec = Random.nextInt(min, max + 1)
        val jitterMillis = Random.nextLong(0, 999)
        return (delaySec * 1000L) + jitterMillis
    }

    /**
     * Sinh độ trễ an toàn giữa các lượt đăng bài liên tiếp (ví dụ 3 đến 6 phút).
     */
    fun calculateInterPostDelayMillis(minMinutes: Int = 3, maxMinutes: Int = 6): Long {
        val min = Math.min(minMinutes, maxMinutes).coerceAtLeast(1)
        val max = Math.max(minMinutes, maxMinutes).coerceAtLeast(min)
        val delayMinutes = Random.nextInt(min, max + 1)
        return delayMinutes * 60 * 1000L + Random.nextLong(0, 5000)
    }

    /**
     * Kiểm tra xem thời điểm hiện tại có nằm trong khung giờ cho phép hoạt động không.
     */
    fun isWithinActiveHours(startHour: Int = 8, endHour: Int = 22): Boolean {
        val calendar = Calendar.getInstance()
        val currentHour = calendar.get(Calendar.HOUR_OF_DAY)
        return if (startHour <= endHour) {
            currentHour in startHour until endHour
        } else {
            // Khung giờ xuyên đêm (ví dụ 20h đến 6h sáng)
            currentHour >= startHour || currentHour < endHour
        }
    }
}
