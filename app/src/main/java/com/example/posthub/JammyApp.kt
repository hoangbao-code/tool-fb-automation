package com.example.posthub

import android.app.Application
import android.os.Build
import com.example.posthub.data.AppLog
import com.example.posthub.di.AppContainer

class JammyApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        // 1. Khởi tạo bộ ghi log
        AppLog.init(this)
        AppLog.i("JammyApp", "Ứng dụng Jammy_post_hub khởi động.")
        AppLog.i("JammyApp", "Thiết bị: ${Build.MANUFACTURER} ${Build.MODEL} - Android SDK: ${Build.VERSION.SDK_INT}")

        // 2. Khởi tạo container thủ công
        container = AppContainer(this)
    }

    companion object {
        lateinit var instance: JammyApp
            private set
    }
}
