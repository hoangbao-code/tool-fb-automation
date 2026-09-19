package com.example.posthub.domain

import com.example.posthub.fb.JitterPolicy
import org.junit.Assert.assertTrue
import org.junit.Test

class JitterPolicyTest {

    @Test
    fun testActionDelayBounds() {
        for (i in 0 until 50) {
            val delay = JitterPolicy.calculateActionDelayMillis(minSec = 5, maxSec = 15)
            assertTrue("Độ trễ thao tác phải >= 5000ms", delay >= 5000L)
            assertTrue("Độ trễ thao tác phải <= 16000ms", delay <= 16000L)
        }
    }

    @Test
    fun testInterPostDelayBounds() {
        for (i in 0 until 20) {
            val delay = JitterPolicy.calculateInterPostDelayMillis(minMinutes = 3, maxMinutes = 6)
            assertTrue("Độ trễ giữa các bài đăng phải >= 3 phút (180.000ms)", delay >= 180000L)
            assertTrue("Độ trễ giữa các bài đăng phải <= 7 phút (420.000ms)", delay <= 420000L)
        }
    }
}
