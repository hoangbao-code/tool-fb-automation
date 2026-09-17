package com.zalotofb.poster.services

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.ListenableWorker.Result as WorkResult
import androidx.work.WorkerParameters
import com.zalotofb.poster.data.models.PostStatus
import com.zalotofb.poster.data.repository.StorageRepository
import com.zalotofb.poster.facebook.FacebookSessionManager
import com.zalotofb.poster.facebook.FacebookUploader
import kotlinx.coroutines.delay
import kotlin.random.Random

class FacebookPostWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        const val KEY_POST_ID = "key_worker_post_id"
        private const val TAG = "FacebookPostWorker"
    }

    override suspend fun doWork(): WorkResult {
        val postId = inputData.getString(KEY_POST_ID) ?: return WorkResult.failure()
        val repository = StorageRepository.getInstance(applicationContext)
        val settings = repository.getSettings()

        val post = repository.getPosts().find { it.id == postId } ?: return WorkResult.failure()

        repository.updatePostStatus(postId, PostStatus.POSTING)
        val targetGroups = if (post.targetGroupIds.isNotEmpty()) {
            post.targetGroupIds
        } else {
            repository.getFacebookGroups().filter { it.isSelected }.map { it.id }
        }

        if (targetGroups.isEmpty()) {
            repository.updatePostStatus(postId, PostStatus.FAILED, errorMsg = "Không có nhóm Facebook nào được chọn để đăng")
            return WorkResult.failure()
        }

        val sessionManager = FacebookSessionManager.getInstance(applicationContext)
        if (!sessionManager.isLoggedIn()) {
            repository.updatePostStatus(postId, PostStatus.FAILED, errorMsg = "Chưa đăng nhập Facebook. Vui lòng đăng nhập trong tab Nhóm Facebook")
            return WorkResult.failure()
        }

        val contentToPost = post.processedContent.ifBlank { post.originalContent }
        var postedCount = 0
        var lastSuccessUrl = ""
        var lastError = ""

        for ((index, groupId) in targetGroups.withIndex()) {
            try {
                // Giãn cách ngẫu nhiên an toàn giữa các nhóm (Anti-Ban Jitter)
                if (index > 0) {
                    val baseDelay = settings.antiBanDelaySeconds
                    val jitter = Random.nextInt(-15, 30) // Dao động ngẫu nhiên -15s đến +30s
                    val sleepTimeSeconds = Math.max(30, baseDelay + jitter)
                    Log.d(TAG, "Đang giãn cách $sleepTimeSeconds giây trước khi đăng nhóm tiếp theo ($groupId)...")
                    delay(sleepTimeSeconds * 1000L)
                }

                val postResult = FacebookUploader.postToFacebookGroup(
                    context = applicationContext,
                    groupId = groupId,
                    content = contentToPost,
                    imageUris = post.imageUris
                )

                postResult.onSuccess { url ->
                    postedCount++
                    lastSuccessUrl = url
                    Log.d(TAG, "Đăng thành công lên nhóm $groupId: $url")
                }.onFailure { err ->
                    lastError = err.message ?: "Lỗi không xác định khi đăng nhóm $groupId"
                    Log.e(TAG, "Đăng thất bại lên nhóm $groupId: $lastError")
                }

            } catch (e: Exception) {
                lastError = e.message ?: "Lỗi ngoại lệ"
            }
        }

        return if (postedCount > 0) {
            repository.updatePostStatus(
                postId,
                PostStatus.POSTED,
                postUrl = lastSuccessUrl
            )
            WorkResult.success()
        } else {
            repository.updatePostStatus(
                postId,
                PostStatus.FAILED,
                errorMsg = lastError
            )
            WorkResult.failure()
        }
    }
}
