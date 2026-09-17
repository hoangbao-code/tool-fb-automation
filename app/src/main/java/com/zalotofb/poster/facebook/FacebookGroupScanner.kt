package com.zalotofb.poster.facebook

import android.content.Context
import android.util.Log
import com.zalotofb.poster.data.models.FacebookGroup
import com.zalotofb.poster.engine.ContentFilterEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import java.util.regex.Pattern

object FacebookGroupScanner {

    private const val TAG = "FBGroupScanner"
    private const val USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

    private val client = OkHttpClient.Builder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    // Regex bắt thẻ link nhóm trên mbasic và m.facebook
    private val GROUP_LINK_REGEX = Pattern.compile(
        """href=["'](?:https?://(?:m|mbasic)\.facebook\.com)?/groups/(\d+)[^"']*["'][^>]*>(.*?)</a>""",
        Pattern.CASE_INSENSITIVE
    )

    private val IGNORED_KEYWORDS = setOf(
        "tạo nhóm", "tạo nhóm mới", "khám phá", "xem thêm", "cài đặt",
        "create group", "discover", "settings", "see more", "nhóm của bạn", "thông báo"
    )

    /**
     * Tự động quét toàn bộ nhóm mà tài khoản Facebook hiện tại đã tham gia
     */
    suspend fun scanJoinedGroups(context: Context): Result<List<FacebookGroup>> = withContext(Dispatchers.IO) {
        val sessionManager = FacebookSessionManager.getInstance(context)
        val cookies = sessionManager.getCookies()

        if (!sessionManager.isLoggedIn()) {
            return@withContext Result.failure(Exception("Chưa đăng nhập Facebook. Vui lòng đăng nhập trước khi quét."))
        }

        val groupsFound = mutableListOf<FacebookGroup>()
        val seenIds = mutableSetOf<String>()

        val scanUrls = listOf(
            "https://mbasic.facebook.com/groups/?seemore",
            "https://mbasic.facebook.com/groups/",
            "https://m.facebook.com/groups/joins/"
        )

        for (url in scanUrls) {
            try {
                val request = Request.Builder()
                    .url(url)
                    .header("Cookie", cookies)
                    .header("User-Agent", USER_AGENT)
                    .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                    .header("Accept-Language", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7")
                    .get()
                    .build()

                val response = client.newCall(request).execute()
                val html = response.body?.string() ?: ""

                if (!response.isSuccessful || html.isBlank()) {
                    continue
                }

                val matcher = GROUP_LINK_REGEX.matcher(html)
                while (matcher.find()) {
                    val id = matcher.group(1)?.trim() ?: continue
                    val rawName = matcher.group(2)?.trim() ?: ""

                    // Làm sạch tên nhóm
                    val cleanName = rawName.replace(Regex("<[^>]+>"), "")
                        .replace("&amp;", "&")
                        .replace("&quot;", """)
                        .replace("&#039;", "'")
                        .replace("&lt;", "<")
                        .replace("&gt;", ">")
                        .trim()

                    if (cleanName.isNotBlank() && !seenIds.contains(id) && !isIgnored(cleanName)) {
                        seenIds.add(id)
                        val district = ContentFilterEngine.extractDistrict(cleanName)
                        groupsFound.add(
                            FacebookGroup(
                                id = id,
                                name = cleanName,
                                districtTag = district,
                                isSelected = true
                            )
                        )
                    }
                }

                if (groupsFound.isNotEmpty()) {
                    break
                }
            } catch (e: Exception) {
                Log.w(TAG, "Lỗi quét từ $url: ${e.message}")
            }
        }

        if (groupsFound.isEmpty()) {
            Result.failure(Exception("Không tìm thấy nhóm nào. Vui lòng kiểm tra lại Cookie đăng nhập hoặc đảm bảo nick đã tham gia các nhóm BĐS."))
        } else {
            Result.success(groupsFound)
        }
    }

    private fun isIgnored(name: String): Boolean {
        val lower = name.lowercase().trim()
        return IGNORED_KEYWORDS.any { lower == it || lower.startsWith(it) }
    }
}
