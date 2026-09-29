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
        val reportLines = mutableListOf<String>()
        val sdf = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault())
        val startTimeStr = sdf.format(java.util.Date())

        reportLines.add("==================================================")
        reportLines.add("BÁO CÁO TỔNG HỢP KẾT QUẢ ĐĂNG BÀI FACEBOOK")
        reportLines.add("Mã bài viết: #$postId")
        reportLines.add("Thời gian bắt đầu: $startTimeStr")
        reportLines.add("Tổng số nhóm mục tiêu: ${groupIds.size}")
        reportLines.add("==================================================")
        reportLines.add("")
        reportLines.add("CHI TIẾT TIẾN ĐỘ TỪNG NHÓM:")

        var successCount = 0
        var pendingCount = 0
        var failedCount = 0

        for (groupId in groupIds) {
            if (secureStore.isEmergencyStop()) {
                AppLog.w("PostWorker", "Đã dừng tiến trình đăng bài do DỪNG KHẨN CẤP.")
                reportLines.add("⚠️ TIẾN TRÌNH BỊ HỦY DO DỪNG KHẨN CẤP")
                break
            }

            val group = db.fbGroupDao().getGroupById(groupId) ?: continue

            AppLog.i("PostWorker", "--------------------------------------------------")
            AppLog.i("PostWorker", "Đang xử lý đăng bài nhóm [${group.name}] (${group.url})...")

            val postResult = container.fbWebSession.postToGroup(
                groupUrl = group.url,
                content = post.finalPostText,
                isAssisted = isAssisted
            )

            val fbResult = postResult.getOrNull()
            if (postResult.isSuccess && fbResult != null) {
                when (fbResult.status) {
                    "SUCCESS" -> {
                        anySuccess = true
                        successCount++
                        val postUrl = fbResult.postUrl ?: group.url
                        AppLog.i("PostWorker", "✓ [ĐÃ ĐĂNG THÀNH CÔNG] Nhóm [${group.name}]: $postUrl")
                        reportLines.add("✓ [ĐÃ ĐĂNG] ${group.name} -> $postUrl")

                        db.postLogDao().insertLog(
                            PostLogEntity(
                                postId = postId,
                                groupId = groupId,
                                groupName = group.name,
                                status = "SUCCESS",
                                mode = if (isAssisted) "ASSISTED" else "AUTO",
                                errorMessage = postUrl
                            )
                        )
                        db.fbGroupDao().updateGroup(group.copy(lastPostedAt = System.currentTimeMillis()))
                    }
                    "PENDING_APPROVAL" -> {
                        anySuccess = true
                        pendingCount++
                        val pendingUrl = fbResult.postUrl ?: group.url
                        AppLog.w("PostWorker", "⏳ [BÀI ĐANG CHỜ DUYỆT] Nhóm [${group.name}] cần Quản trị viên duyệt bài!")
                        reportLines.add("⏳ [CHỜ DUYỆT] ${group.name} -> Đang chờ Quản trị viên xét duyệt ($pendingUrl)")

                        db.postLogDao().insertLog(
                            PostLogEntity(
                                postId = postId,
                                groupId = groupId,
                                groupName = group.name,
                                status = "PENDING_APPROVAL",
                                mode = if (isAssisted) "ASSISTED" else "AUTO",
                                errorMessage = "Bài viết đang chờ Quản trị viên duyệt"
                            )
                        )
                        db.fbGroupDao().updateGroup(group.copy(lastPostedAt = System.currentTimeMillis()))
                    }
                    "ASSISTED_READY" -> {
                        anySuccess = true
                        AppLog.i("PostWorker", "ℹ [TRỢ LỰC] Đã mở và điền sẵn bài nhóm [${group.name}].")
                        reportLines.add("ℹ [TRỢ LỰC] ${group.name} -> Đã điền sẵn nội dung")
                        db.postLogDao().insertLog(
                            PostLogEntity(
                                postId = postId,
                                groupId = groupId,
                                groupName = group.name,
                                status = "ASSISTED",
                                mode = "ASSISTED",
                                errorMessage = "Đã điền sẵn bài viết"
                            )
                        )
                    }
                    else -> {
                        failedCount++
                        val reason = fbResult.error ?: "Lỗi không xác định"
                        AppLog.e("PostWorker", "✗ [THẤT BẠI] Nhóm [${group.name}]: $reason")
                        reportLines.add("✗ [THẤT BẠI] ${group.name} -> $reason")

                        db.postLogDao().insertLog(
                            PostLogEntity(
                                postId = postId,
                                groupId = groupId,
                                groupName = group.name,
                                status = "FAILED",
                                mode = if (isAssisted) "ASSISTED" else "AUTO",
                                errorMessage = reason
                            )
                        )
                    }
                }
            } else {
                failedCount++
                val err = postResult.exceptionOrNull()?.message ?: "Lỗi không xác định"
                AppLog.e("PostWorker", "✗ [THẤT BẠI] Nhóm [${group.name}]: $err")
                reportLines.add("✗ [THẤT BẠI] ${group.name} -> $err")

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

        // Tạo phần tổng kết báo cáo
        val endTimeStr = sdf.format(java.util.Date())
        reportLines.add("")
        reportLines.add("==================================================")
        reportLines.add("TỔNG KẾT:")
        reportLines.add("- Đăng thành công (có link): $successCount nhóm")
        reportLines.add("- Đang chờ Quản trị viên duyệt: $pendingCount nhóm")
        reportLines.add("- Đăng thất bại: $failedCount nhóm")
        reportLines.add("Thời gian kết thúc: $endTimeStr")
        reportLines.add("==================================================")

        // Xuất ra file báo cáo
        val reportContent = reportLines.joinToString("\n")
        try {
            val reportsDir = java.io.File(applicationContext.filesDir, "reports")
            if (!reportsDir.exists()) reportsDir.mkdirs()
            val reportFile = java.io.File(reportsDir, "bao_cao_dang_bai_${postId}.txt")
            reportFile.writeText(reportContent)
            AppLog.i("PostWorker", "==================================================")
            AppLog.i("PostWorker", "🎉 HOÀN TẤT ĐĂNG BÀI TOÀN BỘ CÁC NHÓM!")
            AppLog.i("PostWorker", "📄 Đã xuất file báo cáo tổng hợp tại: ${reportFile.absolutePath}")
            AppLog.i("PostWorker", "==================================================")
        } catch (e: Exception) {
            AppLog.e("PostWorker", "Không thể ghi file báo cáo: ${e.message}")
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
