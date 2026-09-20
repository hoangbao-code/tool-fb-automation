package com.example.posthub.updater

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.example.posthub.data.AppLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

sealed class UpdateState {
    object Idle : UpdateState()
    data class Downloading(val downloadedBytes: Long, val totalBytes: Long, val progress: Float) : UpdateState()
    object ReadyToInstall : UpdateState()
    data class Error(val message: String) : UpdateState()
}

object AppUpdater {

    const val NIGHTLY_APK_URL = "https://github.com/hoangbao-code/tool-fb-automation/releases/download/nightly/app-debug.apk"

    /**
     * Tải file APK mới nhất từ GitHub Releases và tự động kích hoạt trình cài đặt hệ thống
     */
    suspend fun downloadAndInstall(
        context: Context,
        onProgress: (UpdateState) -> Unit
    ): Result<File> = withContext(Dispatchers.IO) {
        try {
            AppLog.i("AppUpdater", "Bắt đầu tải bản cập nhật APK mới từ: $NIGHTLY_APK_URL")
            onProgress(UpdateState.Downloading(0L, -1L, 0f))

            // Mở kết nối và tự động xử lý chuyển hướng (Redirect HTTP 302 của GitHub)
            val connection = openConnectionWithRedirects(NIGHTLY_APK_URL)
            val totalBytes = connection.contentLengthLong.takeIf { it > 0 } ?: connection.contentLength.toLong()

            val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
            val apkFile = File(updatesDir, "jammy_update.apk")
            if (apkFile.exists()) {
                apkFile.delete()
            }

            var downloadedBytes = 0L
            connection.inputStream.use { input ->
                FileOutputStream(apkFile).use { output ->
                    val buffer = ByteArray(8192)
                    var bytesRead: Int
                    var lastProgressUpdate = 0L

                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        downloadedBytes += bytesRead

                        val now = System.currentTimeMillis()
                        if (now - lastProgressUpdate > 100 || downloadedBytes == totalBytes) {
                            lastProgressUpdate = now
                            val progress = if (totalBytes > 0) downloadedBytes.toFloat() / totalBytes.toFloat() else 0f
                            onProgress(UpdateState.Downloading(downloadedBytes, totalBytes, progress))
                        }
                    }
                    output.flush()
                }
            }

            AppLog.i("AppUpdater", "Tải xong APK (${downloadedBytes / 1024 / 1024} MB). Đang kích hoạt cài đặt...")
            onProgress(UpdateState.ReadyToInstall)

            withContext(Dispatchers.Main) {
                installApk(context, apkFile)
            }

            Result.success(apkFile)
        } catch (e: Exception) {
            AppLog.e("AppUpdater", "Lỗi tải bản cập nhật: ${e.message}", e)
            onProgress(UpdateState.Error(e.message ?: "Lỗi tải file APK"))
            Result.failure(e)
        }
    }

    /**
     * Mở kết nối hỗ trợ theo đuôi redirect nhiều cấp của GitHub Releases (S3 storage)
     */
    fun openConnectionWithRedirects(urlString: String, maxRedirects: Int = 6): HttpURLConnection {
        var currentUrl = urlString
        var redirects = 0
        while (redirects < maxRedirects) {
            val url = URL(currentUrl)
            val conn = url.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 30000
            conn.readTimeout = 30000
            conn.setRequestProperty("User-Agent", "JammyPostHub-Updater")
            conn.connect()

            val code = conn.responseCode
            if (code == HttpURLConnection.HTTP_MOVED_TEMP ||
                code == HttpURLConnection.HTTP_MOVED_PERM ||
                code == 307 || code == 308) {
                val newUrl = conn.getHeaderField("Location")
                conn.disconnect()
                if (newUrl != null) {
                    currentUrl = newUrl
                    redirects++
                    continue
                }
            }
            if (code in 200..299) {
                return conn
            } else {
                conn.disconnect()
                throw IllegalStateException("GitHub trả về mã lỗi HTTP $code")
            }
        }
        throw IllegalStateException("Quá số lần chuyển hướng liên kết tải APK ($maxRedirects)")
    }

    /**
     * Kích hoạt Package Installer của Android để cài đặt đè ứng dụng
     */
    fun installApk(context: Context, apkFile: File) {
        if (!apkFile.exists()) {
            AppLog.e("AppUpdater", "File APK không tồn tại để cài đặt: ${apkFile.absolutePath}")
            return
        }

        // Kiểm tra quyền cài đặt ứng dụng từ nguồn không xác định trên Android 8.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.packageManager.canRequestPackageInstalls()) {
                AppLog.w("AppUpdater", "Chưa cấp quyền REQUEST_INSTALL_PACKAGES, đang mở cài đặt...")
                val permissionIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(permissionIntent)
            }
        }

        val apkUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile
        )

        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        AppLog.i("AppUpdater", "Đang mở hộp thoại cài đặt đè APK hệ thống...")
        context.startActivity(installIntent)
    }
}
