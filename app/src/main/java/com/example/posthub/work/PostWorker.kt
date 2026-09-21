package com.example.posthub.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.entity.PostLogEntity
import com.example.posthub.domain.model.PostStatus
import com.example.posthub.fb.JitterPolicy
import kotlinx.coroutines.delay
import java.util.Calendar

class PostWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val postId = inputData.getLong(KEY_POST_ID, -1L)
        val isAssisted = inputData.getBoolean(KEY_IS_ASSISTED, true)

        if (postId == -1L) return Result.failure()

        val container = JammyApp.instance.container
        val secureStore = container.secureStore
        val db = container.database

        AppLog.i("PostWorker", "Bắt đầu xử lý hàng đợi đăng bài (Post ID: $postId)")

        // 1. Kiểm tra dừng khẩn cấp
        if (secureStore.isEmergencyStop()) {
            AppLog.w("PostWorker", "Hủy lượt đăng bài vì đang kích hoạt DỪNG KHẨN CẤP.")
            return Result.failure()
        }

        // 2. Kiểm tra khung giờ hoạt động
        val startHour = secureStore.getActiveHourStart()
        val endHour = secureStore.getActiveHourEnd()
        if (!JitterPolicy.isWithinActiveHours(startHour, endHour)) {
            AppLog.w("PostWorker", "Hiện tại đang ngoài khung giờ hoạt động ($startHour:00 - $endHour:00). Đặt lại lịch cho lần sau.")
            return Result.retry()
        }

        // 3. Kiểm tra giới hạn số bài đăng trong ngày hôm nay
        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val startOfDay = calendar.timeInMillis
        val countToday = db.postLogDao().getSuccessfulPostCountSince(startOfDay)
        val maxPerDay = secureStore.getMaxPostsPerDay()

        if (countToday >= maxPerDay) {
            AppLog.w("PostWorker", "Đã đạt giới hạn $maxPerDay bài đăng hôm nay (Đã đăng: $countToday). Tạm dừng hàng đợi.")
            return Result.failure()
        }

        // 4. Lấy dữ liệu bài đăng
        val post = db.postDao().getPostById(postId) ?: return Result.failure()
        db.postDao().updatePost(post.copy(status = PostStatus.POSTING))

        // 5. Lấy danh sách nhóm đích
        val groupIds = container.converters.toLongList(post.targetGroupIdsJson)
        if (groupIds.isEmpty()) {
            AppLog.w("PostWorker", "Bài đăng #$postId không có nhóm Facebook nào được chọn.")
            db.postDao().updatePost(post.copy(status = PostStatus.FAILED, errorMessage = "Chưa chọn nhóm"))
            return Result.failure()
        }

        var anySuccess = false

        for (groupId in groupIds) {
            if (secureStore.isEmergencyStop()) break

            val group = db.fbGroupDao().getGroupById(groupId) ?: continue

            AppLog.i("PostWorker", "Đang tiến hành đăng bài lên nhóm: '${group.name}' (${group.url})...")

            val postResult = container.fbWebSession.postToGroup(
                groupUrl = group.url,
                content = post.finalPostText,
                isAssisted = isAssisted
            )

            if (postResult.isSuccess) {
                anySuccess = true
                db.postLogDao().insertLog(
                    PostLogEntity(
                        postId = postId,
                        groupId = groupId,
                        groupName = group.name,
                        status = "SUCCESS",
                        mode = if (isAssisted) "ASSISTED" else "AUTO"
                    )
                )
                db.fbGroupDao().updateGroup(group.copy(lastPostedAt = System.currentTimeMillis()))
            } else {
                val err = postResult.exceptionOrNull()?.message ?: "Lỗi không xác định"
                db.postLogDao().insertLog(
                    PostLogEntity(
                        postId = postId,
                        groupId = groupId,
                        groupName = group.name,
                        status = "FAILED",
                        mode = if (isAssisted) "ASSISTED" else "AUTO",
                        errorMessage = err
                    )
                )
            }

            // Giãn cách an toàn giữa các nhóm
            delay(JitterPolicy.calculateInterPostDelayMillis(2, 4))
        }

        if (anySuccess) {
            db.postDao().updatePost(post.copy(status = PostStatus.POSTED))
            AppLog.i("PostWorker", "Hoàn tất xử lý bài đăng #$postId.")
            return Result.success()
        } else {
            db.postDao().updatePost(post.copy(status = PostStatus.FAILED, errorMessage = "Đăng bài thất bại"))
            return Result.failure()
        }
    }

    companion object {
        const val KEY_POST_ID = "KEY_POST_ID"
        const val KEY_IS_ASSISTED = "KEY_IS_ASSISTED"
    }
}
