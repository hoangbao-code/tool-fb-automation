package com.example.posthub.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.example.posthub.data.AppLog

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            AppLog.i("BootReceiver", "Thiết bị vừa khởi động lại. Tự động phục hồi JammyForegroundService.")
            JammyForegroundService.start(context)
        }
    }
}
