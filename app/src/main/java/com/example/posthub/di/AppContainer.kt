package com.example.posthub.di

import android.content.Context
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.AppDatabase
import com.example.posthub.data.local.Converters
import com.example.posthub.data.local.SecureStore
import com.example.posthub.data.local.entity.PostEntity
import com.example.posthub.domain.merger.MessageMerger
import com.example.posthub.domain.model.Post
import com.example.posthub.fb.FbWebSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.example.posthub.domain.ai.AiService
import com.example.posthub.gemini.GeminiWebSession
import com.example.posthub.zalo.ZaloWebSession
import org.json.JSONArray

class AppContainer(val context: Context) {

    val converters = Converters()
    val secureStore = SecureStore(context)
    val database = AppDatabase.getInstance(context)
    val fbWebSession = FbWebSession(context, secureStore)
    val zaloWebSession = ZaloWebSession(context, secureStore)
    val geminiWebSession = GeminiWebSession(context)
    val aiService = AiService(secureStore)

    val messageMerger = MessageMerger(
        windowSecondsProvider = { secureStore.getMergeWindowSeconds() }
    ) { mergedPost ->
        // Khi gộp xong 1 post, lưu tự động vào Room DB
        saveMergedPostToDatabase(mergedPost)
    }

    private fun saveMergedPostToDatabase(post: Post) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val textHash = com.example.posthub.domain.dedup.Deduplicator.computeSimHash(post.rawText)
                if (textHash != 0L) {
                    val existing = database.postDao().findPostByHash(textHash)
                    if (existing != null) {
                        AppLog.w("AppContainer", "Bỏ qua tin nhắn từ [${post.senderOrGroup}] vì trùng lặp hoàn toàn với bài viết #${existing.id}")
                        return@launch
                    }
                }

                var finalText = post.finalPostText
                // Nếu bật tự động viết lại bằng AI và đã cấu hình API Key
                if (secureStore.isAiAutoRewriteEnabled() && secureStore.getGeminiApiKey().isNotBlank()) {
                    AppLog.i("AppContainer", "Đang tự động viết lại bài đăng bằng AI Gemini...")
                    val aiResult = aiService.rewritePost(post.rawText, post.senderOrGroup)
                    aiResult.onSuccess { rewritten ->
                        finalText = rewritten
                        AppLog.i("AppContainer", "Tự động viết lại bằng AI thành công!")
                    }.onFailure { err ->
                        AppLog.w("AppContainer", "Tự động viết lại bằng AI thất bại (sử dụng văn bản gốc): ${err.message}")
                    }
                }

                // Tự động chèn chữ ký / Hotline / Zalo cố định nếu có cấu hình
                val signature = secureStore.getPostSignature()
                if (signature.isNotBlank() && !finalText.contains(signature)) {
                    finalText = "$finalText\n\n$signature".trim()
                }

                val photoArray = JSONArray()
                post.photoPaths.forEach { photoArray.put(it) }

                val entity = PostEntity(
                    rawText = post.rawText,
                    cleanedText = post.cleanedText,
                    finalPostText = finalText,
                    photoPathsJson = photoArray.toString(),
                    source = post.source,
                    senderOrGroup = post.senderOrGroup,
                    status = post.status,
                    textHash = textHash
                )
                val id = database.postDao().insertPost(entity)
                AppLog.i("AppContainer", "Đã lưu bài viết gộp vào Cơ sở dữ liệu Room (ID: #$id, Nguồn: ${post.source})")
            } catch (e: Exception) {
                AppLog.e("AppContainer", "Lỗi lưu bài viết gộp vào DB", e)
            }
        }
    }

    /**
     * Tự động dọn dẹp các bài đã đăng (POSTED) và logs cũ hơn số ngày cấu hình (mặc định 7 ngày)
     */
    fun purgeOldPostsAndLogs() {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val days = secureStore.getAutoCleanupDays()
                if (days > 0) {
                    val cutoff = System.currentTimeMillis() - (days * 24L * 3600L * 1000L)
                    val deletedPosts = database.postDao().deleteOldPostedPosts(cutoff)
                    val deletedLogs = database.postLogDao().deleteOldLogs(cutoff)
                    if (deletedPosts > 0 || deletedLogs > 0) {
                        AppLog.i("AppContainer", "Tự động dọn dẹp: Đã xóa $deletedPosts bài đã đăng và $deletedLogs logs cũ hơn $days ngày.")
                    }
                }
            } catch (e: Exception) {
                AppLog.e("AppContainer", "Lỗi trong quá trình tự động dọn dẹp bài cũ", e)
            }
        }
    }

    /**
     * Tự động quét và đồng bộ nhóm Facebook ngầm
     */
    suspend fun syncJoinedGroupsSilently(): Int = withContext(Dispatchers.IO) {
        try {
            if (!secureStore.isAutoGroupScanEnabled() || secureStore.isEmergencyStop()) {
                return@withContext 0
            }
            if (!fbWebSession.isLoggedIn()) {
                return@withContext 0
            }
            AppLog.i("AppContainer", "Bắt đầu chu kỳ tự động đồng bộ nhóm Facebook ngầm...")
            val result = fbWebSession.scanJoinedGroups()
            if (result.isSuccess) {
                val discovered = result.getOrNull() ?: emptyList()
                var newCount = 0
                for (dg in discovered) {
                    val existing = database.fbGroupDao().getGroupByUrl(dg.url)
                    if (existing == null) {
                        database.fbGroupDao().insertGroup(
                            com.example.posthub.data.local.entity.FbGroupEntity(
                                name = dg.name,
                                url = dg.url,
                                joinStatus = com.example.posthub.domain.model.JoinStatus.JOINED
                            )
                        )
                        newCount++
                    }
                }
                if (newCount > 0) {
                    AppLog.i("AppContainer", "Tự động đồng bộ nhóm FB hoàn tất: Đã lưu thêm $newCount nhóm mới.")
                }
                return@withContext newCount
            }
            0
        } catch (e: Exception) {
            AppLog.e("AppContainer", "Lỗi trong chu kỳ tự động quét nhóm Facebook: ${e.message}", e)
            0
        }
    }

    private val containerScope = CoroutineScope(Dispatchers.IO + kotlinx.coroutines.SupervisorJob())

    init {
        AppLog.i("AppContainer", "Thủ công DI Container khởi tạo hoàn tất với Room DB, SecureStore, FbWebSession, ZaloWebSession và AiService.")
        purgeOldPostsAndLogs()

        fbWebSession.onGroupsAutoDiscovered = { groups ->
            containerScope.launch {
                try {
                    var newCount = 0
                    for (dg in groups) {
                        val existing = database.fbGroupDao().getGroupByUrl(dg.url)
                        if (existing == null) {
                            database.fbGroupDao().insertGroup(
                                com.example.posthub.data.local.entity.FbGroupEntity(
                                    name = dg.name,
                                    url = dg.url,
                                    joinStatus = com.example.posthub.domain.model.JoinStatus.JOINED
                                )
                            )
                            newCount++
                        }
                    }
                    if (newCount > 0) {
                        AppLog.i("AppContainer", "Tự động phát hiện và lưu $newCount nhóm FB mới vào cơ sở dữ liệu.")
                    }
                } catch (e: Exception) {
                    AppLog.e("AppContainer", "Lỗi lưu nhóm FB tự động phát hiện: ${e.message}")
                }
            }
        }
    }
}
