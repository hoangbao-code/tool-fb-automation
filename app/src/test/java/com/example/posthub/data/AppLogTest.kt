package com.example.posthub.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppLogTest {

    @Test
    fun testLogEntryFormatWithoutThrowable() {
        val timestamp = 1710000000000L // Cố định timestamp
        val entry = LogEntry(
            timestamp = timestamp,
            level = LogLevel.INFO,
            tag = "TestTag",
            message = "Thông điệp kiểm tra"
        )

        val formatted = entry.format()
        assertTrue("Log phải chứa level INFO", formatted.contains("[INFO]"))
        assertTrue("Log phải chứa tag [TestTag]", formatted.contains("[TestTag]"))
        assertTrue("Log phải chứa nội dung", formatted.contains("Thông điệp kiểm tra"))
    }

    @Test
    fun testLogEntryFormatWithThrowable() {
        val exception = RuntimeException("Lỗi thử nghiệm kết nối")
        val entry = LogEntry(
            timestamp = System.currentTimeMillis(),
            level = LogLevel.ERROR,
            tag = "ErrorTag",
            message = "Đã xảy ra lỗi nghiêm trọng",
            throwable = exception
        )

        val formatted = entry.format()
        assertTrue("Log phải chứa level ERROR", formatted.contains("[ERROR]"))
        assertTrue("Log phải chứa thông điệp lỗi", formatted.contains("Đã xảy ra lỗi nghiêm trọng"))
        assertTrue("Log phải chứa stack trace exception", formatted.contains("Lỗi thử nghiệm kết nối"))
        assertTrue("Log phải chứa tên class exception", formatted.contains("RuntimeException"))
    }
}
