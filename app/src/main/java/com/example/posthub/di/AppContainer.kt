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
import org.json.JSONArray

class AppContainer(val context: Context) {

    val converters = Converters()
    val secureStore = SecureStore(context)
    val database = AppDatabase.getInstance(context)
    val fbWebSession = FbWebSession(context, secureStore)

    val messageMerger = MessageMerger(
        windowSecondsProvider = { secureStore.getMergeWindowSeconds() }
    ) { mergedPost ->
        // Khi gộp xong 1 post, lưu tự động vào Room DB
        saveMergedPostToDatabase(mergedPost)
    }

    private fun saveMergedPostToDatabase(post: Post) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val photoArray = JSONArray()
                post.photoPaths.forEach { photoArray.put(it) }

                val entity = PostEntity(
                    rawText = post.rawText,
                    cleanedText = post.cleanedText,
                    finalPostText = post.finalPostText,
                    photoPathsJson = photoArray.toString(),
                    source = post.source,
                    senderOrGroup = post.senderOrGroup,
                    status = post.status
                )
                val id = database.postDao().insertPost(entity)
                AppLog.i("AppContainer", "Đã lưu bài viết gộp vào Cơ sở dữ liệu Room (ID: #$id)")
            } catch (e: Exception) {
                AppLog.e("AppContainer", "Lỗi lưu bài viết gộp vào DB", e)
            }
        }
    }

    init {
        AppLog.i("AppContainer", "Thủ công DI Container khởi tạo hoàn tất với Room DB, SecureStore, FbWebSession và MessageMerger.")
    }
}
