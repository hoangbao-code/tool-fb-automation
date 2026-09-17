package com.zalotofb.poster.services

import android.app.Notification
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.*
import com.zalotofb.poster.R
import com.zalotofb.poster.Z2FBApplication
import com.zalotofb.poster.data.models.PostItem
import com.zalotofb.poster.data.models.PostStatus
import com.zalotofb.poster.data.repository.StorageRepository
import com.zalotofb.poster.engine.ContentFilterEngine
import com.zalotofb.poster.engine.PostBatcher
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class ZaloNotificationListener : NotificationListenerService() {

    companion object {
        private const val TAG = "ZaloNotifListener"
        private const val PACKAGE_ZALO = "com.zing.zalo"
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null || sbn.packageName != PACKAGE_ZALO) return

        try {
            val notification = sbn.notification ?: return
            val extras = notification.extras ?: return

            // 1. Trích xuất thông tin người gửi / nhóm Zalo
            val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
            val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
            val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: text

            val content = if (bigText.length > text.length) bigText else text
            if (content.isBlank()) return

            val repository = StorageRepository.getInstance(applicationContext)
            val settings = repository.getSettings()

            // 2. Kiểm tra bộ lọc nhóm Zalo
            if (!ContentFilterEngine.isGroupMonitored(title, settings)) {
                Log.d(TAG, "Bỏ qua do không thuộc nhóm Zalo cấu hình theo dõi: $title")
                return
            }

            // 3. Trích xuất hình ảnh đính kèm nếu có
            val imageUris = mutableListOf<String>()
            val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                extras.getParcelable(Notification.EXTRA_PICTURE, Bitmap::class.java)
            } else {
                @Suppress("DEPRECATION")
                extras.getParcelable(Notification.EXTRA_PICTURE) as? Bitmap
            }

            if (bitmap != null) {
                val savedUri = saveBitmapToCache(bitmap)
                if (savedUri != null) {
                    imageUris.add(savedUri)
                }
            }

            // 4. Kiểm tra tin rác / bỏ qua
            if (ContentFilterEngine.isSpamOrIgnored(content, imageUris.isNotEmpty(), settings)) {
                Log.d(TAG, "Bỏ qua tin nhắn rác/quá ngắn: $content")
                return
            }

            // 5. Khởi tạo PostItem thô
            val rawPost = PostItem(
                id = UUID.randomUUID().toString(),
                zaloGroupName = title,
                senderName = "Zalo Member",
                originalContent = content,
                imageUris = imageUris,
                createdAt = System.currentTimeMillis(),
                status = PostStatus.PENDING
            )

            // 6. Đưa vào PostBatcher để gộp các tin nhắn ảnh gửi dồn dập
            PostBatcher.enqueue(rawPost, settings.batchGroupTimeoutSeconds) { batchedPost ->
                handleCompletedPost(batchedPost)
            }

        } catch (e: Exception) {
            Log.e(TAG, "Lỗi khi phân tích thông báo Zalo: ${e.message}", e)
        }
    }

    private fun handleCompletedPost(post: PostItem) {
        val repository = StorageRepository.getInstance(applicationContext)
        val settings = repository.getSettings()

        // Xử lý tự động thay SĐT, chữ ký và bóc tách dữ liệu CHDV
        post.processedContent = ContentFilterEngine.processContent(post.originalContent, settings)
        post.roomType = ContentFilterEngine.extractRoomType(post.originalContent)
        post.district = ContentFilterEngine.extractDistrict(post.originalContent)
        post.price = ContentFilterEngine.extractPrice(post.originalContent)

        // Gán danh sách Group Facebook mặc định đã được tick chọn
        val activeGroups = repository.getFacebookGroups().filter { it.isSelected }.map { it.id }
        post.targetGroupIds = activeGroups.toMutableList()

        if (settings.isAutoMode) {
            // --- CHẾ ĐỘ TỰ ĐỘNG 100% ---
            post.status = PostStatus.QUEUED
            repository.savePost(post)

            // Đưa vào hàng đợi WorkManager tự động đăng ngầm
            scheduleFacebookPostWork(post.id)
            Log.d(TAG, "Đã tự động xếp hàng đăng Facebook cho bài: ${post.id}")
        } else {
            // --- CHẾ ĐỘ BÁN TỰ ĐỘNG ---
            post.status = PostStatus.PENDING
            repository.savePost(post)

            // Kích hoạt Bong bóng nổi nếu được cấp quyền
            if (settings.isFloatingBubbleEnabled) {
                try {
                    val intent = Intent(this, FloatingBubbleService::class.java).apply {
                        putExtra(FloatingBubbleService.EXTRA_POST_ID, post.id)
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(intent)
                    } else {
                        startService(intent)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Không thể mở Floating Bubble: ${e.message}")
                }
            }

            // Đồng thời bắn thông báo Notification tương tác
            showInteractiveNotification(post)
        }
    }

    private fun scheduleFacebookPostWork(postId: String) {
        val data = workDataOf(FacebookPostWorker.KEY_POST_ID to postId)
        val request = OneTimeWorkRequestBuilder<FacebookPostWorker>()
            .setInputData(data)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, java.util.concurrent.TimeUnit.MINUTES)
            .build()

        WorkManager.getInstance(applicationContext).enqueue(request)
    }

    private fun showInteractiveNotification(post: PostItem) {
        val builder = NotificationCompat.Builder(this, Z2FBApplication.CHANNEL_ALERTS_ID)
            .setSmallIcon(R.drawable.ic_bubble)
            .setContentTitle("Bài viết mới: ${post.zaloGroupName}")
            .setContentText(post.processedContent.take(100))
            .setStyle(NotificationCompat.BigTextStyle().bigText(post.processedContent))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)

        NotificationManagerCompat.from(this).notify(post.id.hashCode(), builder.build())
    }

    private fun saveBitmapToCache(bitmap: Bitmap): String? {
        return try {
            val cacheDir = File(cacheDir, "images").apply { if (!exists()) mkdirs() }
            val file = File(cacheDir, "zalo_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(6)}.jpg")
            FileOutputStream(file).use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }
            Uri.fromFile(file).toString()
        } catch (e: Exception) {
            null
        }
    }
}
