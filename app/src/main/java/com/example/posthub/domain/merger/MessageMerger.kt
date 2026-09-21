package com.example.posthub.domain.merger

import com.example.posthub.data.AppLog
import com.example.posthub.domain.model.Post
import com.example.posthub.domain.model.PostSource
import com.example.posthub.domain.model.PostStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

data class PendingMessageGroup(
    val senderOrGroup: String,
    val texts: MutableList<String> = mutableListOf(),
    val photoPaths: MutableList<String> = mutableListOf(),
    var lastReceivedAt: Long = System.currentTimeMillis(),
    var timerJob: Job? = null
)

class MessageMerger(
    private val windowSecondsProvider: () -> Int = { 20 },
    private val onMergedPostReady: suspend (Post) -> Unit
) {
    private val activeGroups = ConcurrentHashMap<String, PendingMessageGroup>()
    private val scope = CoroutineScope(Dispatchers.Default)

    fun addMessage(
        senderOrGroup: String,
        text: String,
        photoPaths: List<String> = emptyList(),
        source: PostSource = PostSource.NOTIFICATION
    ) {
        val key = senderOrGroup.trim().ifEmpty { "Chung" }
        val windowMillis = windowSecondsProvider() * 1000L

        val group = activeGroups.compute(key) { _, existing ->
            val g = existing ?: PendingMessageGroup(senderOrGroup = key)
            if (text.isNotBlank()) {
                g.texts.add(text.trim())
            }
            for (photo in photoPaths) {
                if (!g.photoPaths.contains(photo)) {
                    g.photoPaths.add(photo)
                }
            }
            g.lastReceivedAt = System.currentTimeMillis()

            // Hủy timer cũ, đặt timer mới theo cửa sổ trượt (sliding window)
            g.timerJob?.cancel()
            g.timerJob = scope.launch {
                delay(windowMillis)
                finalizeGroup(key, source)
            }
            g
        }

        AppLog.i("MessageMerger", "Nhận tin từ [$key]: ${text.take(40)}... (${photoPaths.size} ảnh). Đang chờ thêm tin trong ${windowSecondsProvider()}s.")
    }

    /**
     * Hoàn tất và gom thành một bài Post duy nhất
     */
    private suspend fun finalizeGroup(key: String, source: PostSource) {
        val group = activeGroups.remove(key) ?: return
        val combinedText = group.texts.joinToString("\n\n").trim()
        if (combinedText.isBlank() && group.photoPaths.isEmpty()) return

        val post = Post(
            rawText = combinedText,
            cleanedText = combinedText,
            finalPostText = combinedText,
            photoPaths = group.photoPaths.toList(),
            source = source,
            senderOrGroup = group.senderOrGroup,
            createdAt = System.currentTimeMillis(),
            status = PostStatus.PENDING_REVIEW
        )

        AppLog.i("MessageMerger", "Đã gộp thành công ${group.texts.size} tin nhắn từ [${group.senderOrGroup}] thành 1 Post (${group.photoPaths.size} ảnh).")
        onMergedPostReady(post)
    }

    /**
     * Ép gộp ngay lập tức không cần đợi hết cửa sổ thời gian
     */
    fun flushImmediately(senderOrGroup: String, source: PostSource = PostSource.NOTIFICATION) {
        scope.launch {
            finalizeGroup(senderOrGroup, source)
        }
    }
}
