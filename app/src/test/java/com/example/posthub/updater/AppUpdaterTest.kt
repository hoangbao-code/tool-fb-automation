package com.example.posthub.updater

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdaterTest {

    @Test
    fun testNightlyApkUrlIsValid() {
        val url = AppUpdater.NIGHTLY_APK_URL
        assertTrue("URL tải APK phải bắt đầu bằng https://", url.startsWith("https://"))
        assertTrue("URL tải APK phải từ repo hoangbao-code/tool-fb-automation", url.contains("hoangbao-code/tool-fb-automation"))
        assertTrue("URL tải APK phải chỉ đến file app-debug.apk", url.endsWith("app-debug.apk"))
    }

    @Test
    fun testUpdateStateTransitions() {
        val idle: UpdateState = UpdateState.Idle
        assertNotNull(idle)

        val downloading: UpdateState = UpdateState.Downloading(
            downloadedBytes = 50 * 1024 * 1024L,
            totalBytes = 100 * 1024 * 1024L,
            progress = 0.5f
        )
        assertTrue(downloading is UpdateState.Downloading)
        assertEquals(0.5f, (downloading as UpdateState.Downloading).progress, 0.001f)
        assertEquals(50 * 1024 * 1024L, downloading.downloadedBytes)

        val ready: UpdateState = UpdateState.ReadyToInstall
        assertNotNull(ready)

        val error: UpdateState = UpdateState.Error("Kết nối timeout")
        assertTrue(error is UpdateState.Error)
        assertEquals("Kết nối timeout", (error as UpdateState.Error).message)
    }

    @Test
    fun testProgressCalculationLogic() {
        val downloaded = 25L
        val total = 100L
        val progress = downloaded.toFloat() / total.toFloat()
        assertEquals(0.25f, progress, 0.0001f)
    }
}
