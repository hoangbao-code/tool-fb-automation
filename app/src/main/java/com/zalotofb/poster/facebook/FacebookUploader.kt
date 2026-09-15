package com.zalotofb.poster.facebook

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import com.zalotofb.poster.data.models.PostItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

object FacebookUploader {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    /**
     * Đăng bài trực tiếp lên Group Facebook bằng Session/Cookie
     */
    suspend fun postToFacebookGroup(
        context: Context,
        groupId: String,
        content: String,
        imageUris: List<String>
    ): Result<String> = withContext(Dispatchers.IO) {
        val sessionManager = FacebookSessionManager.getInstance(context)
        val cookies = sessionManager.getCookies()

        if (!sessionManager.isLoggedIn()) {
            return@withContext Result.failure(Exception("Chưa đăng nhập tài khoản Facebook trong ứng dụng"))
        }

        try {
            // Chuẩn bị Request Body dạng Multipart
            val formBuilder = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("message", content)

            // Đính kèm các ảnh có sẵn trong máy
            imageUris.forEachIndexed { index, uriString ->
                try {
                    val file = File(Uri.parse(uriString).path ?: uriString)
                    if (file.exists()) {
                        val mediaType = "image/jpeg".toMediaTypeOrNull()
                        val requestBody = file.asRequestBody(mediaType)
                        formBuilder.addFormDataPart("source_$index", file.name, requestBody)
                    }
                } catch (e: Exception) {
                    // Tiếp tục nếu 1 ảnh bị lỗi đọc
                }
            }

            val requestBody = formBuilder.build()

            // Endpoint Graph API / Group Feed của Facebook
            val request = Request.Builder()
                .url("https://graph.facebook.com/v19.0/$groupId/feed")
                .header("Cookie", cookies)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36")
                .post(requestBody)
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string() ?: ""

            if (response.isSuccessful) {
                val json = JSONObject(responseBody)
                val postId = json.optString("id", "")
                val postUrl = if (postId.isNotBlank()) "https://facebook.com/$postId" else "https://facebook.com/groups/$groupId"
                Result.success(postUrl)
            } else {
                // Thử fallback sang mobile web endpoint hoặc trả về thông báo lỗi
                Result.failure(Exception("Lỗi từ Facebook (${response.code}): $responseBody"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Phương án an toàn: Mở thẳng ứng dụng Facebook chính thức với hình ảnh và tự động sao chép caption
     */
    fun shareViaOfficialFacebookApp(context: Context, post: PostItem) {
        try {
            // Sao chép nội dung vào Clipboard
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("Z2FB Post", post.processedContent.ifBlank { post.originalContent })
            clipboard.setPrimaryClip(clip)

            Toast.makeText(context, "Đã sao chép nội dung! Đang mở Facebook...", Toast.LENGTH_SHORT).show()

            val shareIntent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "image/*"
                setPackage("com.facebook.katana") // App Facebook chính thức
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val uris = ArrayList<Uri>()
            post.imageUris.forEach {
                uris.add(Uri.parse(it))
            }
            if (uris.isNotEmpty()) {
                shareIntent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
            }

            context.startActivity(shareIntent)
        } catch (e: Exception) {
            // Nếu không có app Facebook Katana, mở chooser thông thường
            val genericIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, post.processedContent.ifBlank { post.originalContent })
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(Intent.createChooser(genericIntent, "Chia sẻ bài viết").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        }
    }
}
