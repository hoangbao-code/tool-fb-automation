package com.example.posthub.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.example.posthub.JammyApp
import com.example.posthub.R
import com.example.posthub.data.AppLog
import com.example.posthub.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class JammyForegroundService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var autoScanJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildForegroundNotification("Đang chạy ngầm bắt tin & quét nhóm FB"))
        startAutoGroupScanLoop()
        AppLog.i("ForegroundService", "JammyForegroundService đã khởi động.")
    }

    private fun startAutoGroupScanLoop() {
        autoScanJob?.cancel()
        autoScanJob = serviceScope.launch {
            // Chờ 60 giây sau khi khởi động service để hệ thống ổn định
            delay(60_000L)
            while (isActive) {
                val container = JammyApp.instance.container
                val secureStore = container.secureStore
                if (secureStore.isAutoGroupScanEnabled() && !secureStore.isEmergencyStop()) {
                    try {
                        val newCount = container.syncJoinedGroupsSilently()
                        if (newCount > 0) {
                            AppLog.i("ForegroundService", "Quét nhóm FB định kỳ: Đã phát hiện và thêm $newCount nhóm mới.")
                        }
                    } catch (e: Exception) {
                        AppLog.e("ForegroundService", "Lỗi quét nhóm FB định kỳ: ${e.message}")
                    }
                }
                val intervalMin = container.secureStore.getAutoGroupScanIntervalMin().coerceAtLeast(10)
                delay(intervalMin * 60_000L)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_EMERGENCY_STOP) {
            JammyApp.instance.container.secureStore.setEmergencyStop(true)
            AppLog.w("ForegroundService", "Đã bấm DỪNG KHẨN CẤP từ thông báo!")
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, buildForegroundNotification("⚠️ ĐÃ KÍCH HOẠT DỪNG KHẨN CẤP"))
        }

        return START_STICKY
    }

    private fun buildForegroundNotification(statusText: String): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val emergencyIntent = Intent(this, JammyForegroundService::class.java).apply {
            action = ACTION_EMERGENCY_STOP
        }
        val emergencyPendingIntent = PendingIntent.getService(
            this, 1, emergencyIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Jammy_post_hub")
            .setContentText(statusText)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openAppPendingIntent)
            .setOngoing(true)
            .addAction(R.drawable.ic_launcher_foreground, "Mở ứng dụng", openAppPendingIntent)
            .addAction(R.drawable.ic_launcher_foreground, "Dừng khẩn", emergencyPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Dịch vụ chạy ngầm Jammy",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Giữ cho ứng dụng hoạt động để bắt tin Zalo liên tục"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        AppLog.i("ForegroundService", "JammyForegroundService đã dừng.")
    }

    companion object {
        const val NOTIFICATION_ID = 1001
        const val CHANNEL_ID = "jammy_service_channel"
        const val ACTION_EMERGENCY_STOP = "com.example.posthub.ACTION_EMERGENCY_STOP"

        fun start(context: Context) {
            val intent = Intent(context, JammyForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, JammyForegroundService::class.java)
            context.stopService(intent)
        }
    }
}
