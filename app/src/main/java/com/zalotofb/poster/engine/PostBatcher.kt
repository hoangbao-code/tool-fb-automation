package com.zalotofb.poster.engine

import com.zalotofb.poster.data.models.PostItem
import kotlinx.coroutines.*
import java.util.concurrent.ConcurrentHashMap

object PostBatcher {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val pendingBatches = ConcurrentHashMap<String, MutableList<PostItem>>()
    private val debounceJobs = ConcurrentHashMap<String, Job>()

    /**
     * Nạp một mẩu tin nhắn từ Zalo vào bộ đệm gom bài
     */
    fun enqueue(
        post: PostItem,
        timeoutSeconds: Int,
        onBatchReady: (PostItem) -> Unit
    ) {
        val groupKey = post.zaloGroupName.ifBlank { "default_group" }

        val list = pendingBatches.computeIfAbsent(groupKey) { mutableListOf() }
        synchronized(list) {
            list.add(post)
        }

        // Hủy timer cũ nếu có tin nhắn mới tới trước khi hết timeout
        debounceJobs[groupKey]?.cancel()

        debounceJobs[groupKey] = scope.launch {
            delay(timeoutSeconds * 1000L)
            
            val readyPost: PostItem? = synchronized(list) {
                if (list.isEmpty()) return@synchronized null
                
                // Gom tất cả ảnh và chọn nội dung text dài nhất làm caption chính
                val combinedImages = mutableListOf<String>()
                var bestContent = ""
                var bestSender = ""
                val postIds = mutableListOf<String>()

                for (item in list) {
                    combinedImages.addAll(item.imageUris)
                    if (item.originalContent.length > bestContent.length) {
                        bestContent = item.originalContent
                        bestSender = item.senderName
                    }
                    postIds.add(item.id)
                }

                val finalPost = PostItem(
                    zaloGroupName = groupKey,
                    senderName = bestSender,
                    originalContent = bestContent,
                    imageUris = combinedImages.distinct().toMutableList(),
                    createdAt = System.currentTimeMillis()
                )

                list.clear()
                pendingBatches.remove(groupKey)
                debounceJobs.remove(groupKey)
                finalPost
            }

            readyPost?.let { onBatchReady(it) }
        }
    }
}
