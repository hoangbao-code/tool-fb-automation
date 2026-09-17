package com.zalotofb.poster.services

import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.zalotofb.poster.BuildConfig
import com.zalotofb.poster.R
import com.zalotofb.poster.Z2FBApplication
import com.zalotofb.poster.data.local.AppDatabase
import com.zalotofb.poster.data.local.PreferenceStorage
import com.zalotofb.poster.data.photo.PhotoProcessor
import com.zalotofb.poster.data.repository.ListingRepository
import com.zalotofb.poster.domain.model.Source
import com.zalotofb.poster.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class ZaloNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "ZaloNotifListener"
        private const val PACKAGE_ZALO = "com.zing.zalo"
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        // Strict whitelist: only com.zing.zalo
        if (sbn == null || sbn.packageName != PACKAGE_ZALO) return

        try {
            val notification = sbn.notification ?: return
            val extras = notification.extras ?: return

            // Drop non-message / system notifications
            val category = notification.category
            if (category == Notification.CATEGORY_CALL || category == Notification.CATEGORY_SYSTEM) return

            val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: text

            val content = if (bigText.length > text.length) bigText else text
            if (content.isBlank() || content.length < 15) return

            // Never log notification content in release builds
            if (BuildConfig.DEBUG) {
                Log.d(TAG, "Zalo message received from: $title")
            }

            // Flag truncation risk: length >= 180 or ending in ellipsis
            val isTruncated = content.length >= 180 || content.endsWith("…") || content.endsWith("...")
            val finalContent = if (isTruncated) {
                "[CẢNH BÁO: Tin có thể bị cắt — kiểm tra lại trên Zalo]\n$content"
            } else {
                content
            }

            serviceScope.launch {
                val db = AppDatabase.getInstance(applicationContext)
                val prefs = PreferenceStorage(applicationContext)
                val repository = ListingRepository(db, prefs)

                val listing = repository.ingestRawListing(
                    rawText = finalContent,
                    source = Source.ZALO_NOTIFICATION,
                    sourceGroup = title.ifBlank { null }
                )

                // Check for attached picture
                val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    extras.getParcelable(Notification.EXTRA_PICTURE, Bitmap::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    extras.getParcelable(Notification.EXTRA_PICTURE) as? Bitmap
                }

                if (bitmap != null) {
                    val tempFile = File(cacheDir, "temp_zalo_${UUID.randomUUID()}.jpg")
                    FileOutputStream(tempFile).use { out ->
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
                    }
                    val processedUri = PhotoProcessor.processImage(applicationContext, Uri.fromFile(tempFile))
                    tempFile.delete()
                    if (processedUri != null) {
                        repository.addPhotos(listing.id, listOf(processedUri))
                    }
                }

                showListingNotification(listing.id, title, listing.district, listing.roomType?.displayName)
            }
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) {
                Log.e(TAG, "Error handling notification: ${e.message}", e)
            }
        }
    }

    private fun showListingNotification(
        listingId: String,
        sourceGroup: String,
        district: String?,
        roomType: String?
    ) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("OPEN_LISTING_ID", listingId)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            listingId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val subtext = listOfNotNull(roomType, district).joinToString(" • ")
        val notification = NotificationCompat.Builder(this, Z2FBApplication.CHANNEL_ALERTS_ID)
            .setSmallIcon(R.drawable.ic_bubble)
            .setContentTitle("Tin phòng mới từ $sourceGroup")
            .setContentText(if (subtext.isNotBlank()) subtext else "Bấm để kiểm tra và đăng bài")
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        NotificationManagerCompat.from(this).notify(listingId.hashCode(), notification)
    }
}
