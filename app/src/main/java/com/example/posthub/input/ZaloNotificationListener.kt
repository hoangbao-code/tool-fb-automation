package com.example.posthub.input

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.domain.model.PostSource
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

class ZaloNotificationListener : NotificationListenerService() {

    private val loggedOtherPackages = ConcurrentHashMap.newKeySet<String>()

    override fun onListenerConnected() {
        super.onListenerConnected()
        AppLog.i("ZaloNotifListener", "Dịch vụ lắng nghe thông báo đã kết nối thành công.")
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        AppLog.w("ZaloNotifListener", "Dịch vụ lắng nghe thông báo bị ngắt kết nối.")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return

        val pkgName = sbn.packageName ?: return
        val targetZaloPkg = JammyApp.instance.container.secureStore.getZaloPackage()

        // Nếu là ứng dụng khác: chỉ ghi nhận tên gói 1 lần duy nhất, TUYỆT ĐỐI không ghi nội dung
        if (pkgName != targetZaloPkg) {
            if (loggedOtherPackages.add(pkgName)) {
                AppLog.d("ZaloNotifListener", "Phát hiện thông báo từ app khác (bỏ qua): $pkgName")
            }
            return
        }

        // Là thông báo từ Zalo: xử lý chi tiết
        val notification = sbn.notification ?: return
        val extras = notification.extras ?: return

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""

        val finalMessageContent = when {
            !bigText.isNullOrBlank() -> bigText
            text.isNotBlank() -> text
            else -> ""
        }

        // Bỏ qua các thông báo hệ thống / gọi điện / online của Zalo
        if (finalMessageContent.isBlank() && title.isBlank()) return
        if (finalMessageContent.contains("cuộc gọi nhỡ", ignoreCase = true) ||
            finalMessageContent.contains("đang gọi cho bạn", ignoreCase = true)) {
            return
        }

        val postTime = sbn.postTime
        val keysList = extras.keySet().joinToString(", ")

        AppLog.i(
            "ZaloNotifListener",
            "ĐÃ BẮT ĐƯỢC THÔNG BÁO ZALO:\n" +
            "- Người gửi/Nhóm: '$title' (SubText: '$subText')\n" +
            "- Độ dài nội dung: ${finalMessageContent.length} ký tự\n" +
            "- Nội dung: ${finalMessageContent.take(100)}...\n" +
            "- Extras keys có mặt: [$keysList]"
        )

        // Ghi lại phát hiện vào file ZALO_FINDINGS.md để người dùng đối chiếu
        recordZaloFinding(title, subText, finalMessageContent, keysList)

        // Đưa vào bộ gộp tin nhắn (MessageMerger)
        JammyApp.instance.container.messageMerger.addMessage(
            senderOrGroup = if (title.isNotBlank()) title else "Zalo",
            text = finalMessageContent,
            photoPaths = emptyList(),
            source = PostSource.NOTIFICATION
        )
    }

    private fun recordZaloFinding(title: String, subText: String, content: String, keys: String) {
        try {
            val findingsFile = File(filesDir, "ZALO_FINDINGS.md")
            val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
            val timeStr = sdf.format(Date())

            FileWriter(findingsFile, true).use { fw ->
                fw.write("### Phát hiện lúc: $timeStr\n")
                fw.write("- **Title**: $title\n")
                fw.write("- **SubText**: $subText\n")
                fw.write("- **Content Length**: ${content.length}\n")
                fw.write("- **Keys**: $keys\n")
                fw.write("- **Preview**: ```\n$content\n```\n\n---\n")
            }
        } catch (e: Exception) {
            AppLog.e("ZaloNotifListener", "Lỗi ghi file ZALO_FINDINGS.md", e)
        }
    }
}
