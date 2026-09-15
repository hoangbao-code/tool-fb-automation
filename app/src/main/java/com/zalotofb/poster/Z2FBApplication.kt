package com.zalotofb.poster

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

class Z2FBApplication : Application() {

    companion object {
        const val CHANNEL_SERVICE_ID = "z2fb_foreground_service"
        const val CHANNEL_ALERTS_ID = "z2fb_alerts"
        lateinit var instance: Z2FBApplication
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_SERVICE_ID,
                "Z2FB Background Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Kênh thông báo dịch vụ chạy ngầm bắt tin Zalo và đăng FB"
            }

            val alertsChannel = NotificationChannel(
                CHANNEL_ALERTS_ID,
                "Z2FB Thông báo bài mới",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Thông báo khi có bài viết mới từ nhóm Zalo cần duyệt"
                enableVibration(true)
            }

            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(serviceChannel)
            manager.createNotificationChannel(alertsChannel)
        }
    }
}
