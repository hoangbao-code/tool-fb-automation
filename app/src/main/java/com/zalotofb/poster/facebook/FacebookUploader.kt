package com.zalotofb.poster.facebook

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.widget.Toast
import com.zalotofb.poster.data.models.PostItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern

object FacebookUploader {

    private const val TAG = "FacebookUploader"
    private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    /**
     * Đăng bài trực tiếp lên Nhóm Facebook bằng giao diện mbasic với bảo mật fb_dtsg
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
            return@withContext Result.failure(Exception("Chưa đăng nhập tài khoản Facebook"))
        }

        try {
            // BƯỚC 1: Tải trang nhóm trên mbasic để trích xuất form composer và token bảo mật fb_dtsg
            val groupUrl = "https://mbasic.facebook.com/groups/$groupId"
            val getGroupReq = Request.Builder()
                .url(groupUrl)
                .header("Cookie", cookies)
                .header("User-Agent", USER_AGENT)
                .get()
                .build()

            val groupResp = client.newCall(getGroupReq).execute()
            val groupHtml = groupResp.body?.string() ?: ""

            if (!groupResp.isSuccessful || groupHtml.isBlank()) {
                return@withContext Result.failure(Exception("Không thể kết nối đến nhóm $groupId (Mã lỗi: ${groupResp.code})"))
            }

            // Trích xuất action URL của Form Composer
            val formActionMatcher = Pattern.compile("""<form[^>]*action=["'](/composer/mbasic/[^"']+)["']""", Pattern.CASE_INSENSITIVE).matcher(groupHtml)
            val formAction = if (formActionMatcher.find()) {
                "https://mbasic.facebook.com" + formActionMatcher.group(1)!!.replace("&amp;", "&")
            } else {
                "https://mbasic.facebook.com/composer/mbasic/?target=$groupId"
            }

            // Trích xuất fb_dtsg và jazoest
            val fbDtsgMatcher = Pattern.compile("""name=["']fb_dtsg["'][^>]*value=["']([^"']+)["']""", Pattern.CASE_INSENSITIVE).matcher(groupHtml)
            val fbDtsg = if (fbDtsgMatcher.find()) fbDtsgMatcher.group(1)!! else ""

            val jazoestMatcher = Pattern.compile("""name=["']jazoest["'][^>]*value=["']([^"']+)["']""", Pattern.CASE_INSENSITIVE).matcher(groupHtml)
            val jazoest = if (jazoestMatcher.find()) jazoestMatcher.group(1)!! else ""

            // BƯỚC 2: Chuẩn bị Multipart Form Request
            val formBuilder = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("fb_dtsg", fbDtsg)
                .addFormDataPart("jazoest", jazoest)
                .addFormDataPart("target", groupId)
                .addFormDataPart("xc_message", content)
                .addFormDataPart("view_post", "Đăng")

            // Đính kèm ảnh nếu có
            var attachedPhotosCount = 0
            imageUris.forEachIndexed { index, uriStr ->
                try {
                    val file = File(Uri.parse(uriStr).path ?: uriStr)
                    if (file.exists() && file.length() > 0) {
                        val body = file.asRequestBody("image/jpeg".toMediaTypeOrNull())
                        formBuilder.addFormDataPart("file${index + 1}", file.name, body)
                        attachedPhotosCount++
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Bỏ qua ảnh lỗi: ${e.message}")
                }
            }

            // BƯỚC 3: Gửi bài đăng
            val postReq = Request.Builder()
                .url(formAction)
                .header("Cookie", cookies)
                .header("User-Agent", USER_AGENT)
                .header("Referer", groupUrl)
                .post(formBuilder.build())
                .build()

            val postResp = client.newCall(postReq).execute()
            val postRespBody = postResp.body?.string() ?: ""

            // Kiểm tra kết quả phản hồi
            val isSuccess = postResp.isSuccessful && !postRespBody.contains("checkpoint") && !postRespBody.contains("bị chặn")
            if (isSuccess) {
                val postUrl = "https://facebook.com/groups/$groupId"
                Result.success(postUrl)
            } else {
                val errorSummary = when {
                    postRespBody.contains("checkpoint") -> "Tài khoản Facebook bị yêu cầu xác minh (Checkpoint)"
                    postRespBody.contains("phê duyệt") -> "Bài viết đã gửi và đang chờ Admin nhóm phê duyệt"
                    else -> "Lỗi phản hồi từ Facebook (${postResp.code})"
                }
                Result.failure(Exception(errorSummary))
            }

        } catch (e: Exception) {
            Log.e(TAG, "Lỗi ngoại lệ khi đăng bài nhóm $groupId: ${e.message}", e)
            Result.failure(e)
        }
    }

    /**
     * Phương án Bán tự động 1-chạm: Mở thẳng Facebook App chính thức kèm album ảnh và tự động copy caption
     */
    fun shareViaOfficialFacebookApp(context: Context, post: PostItem) {
        try {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("CHDV Post", post.processedContent.ifBlank { post.originalContent })
            clipboard.setPrimaryClip(clip)

            Toast.makeText(context, "Đã sao chép nội dung bài đăng! Đang mở Facebook...", Toast.LENGTH_SHORT).show()

            val shareIntent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "image/*"
                setPackage("com.facebook.katana")
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
            val genericIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, post.processedContent.ifBlank { post.originalContent })
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(Intent.createChooser(genericIntent, "Chia sẻ bài đăng CHDV").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        }
    }
}
