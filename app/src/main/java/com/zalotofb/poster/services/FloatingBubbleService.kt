package com.zalotofb.poster.services

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.*
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.bumptech.glide.Glide
import com.google.android.material.button.MaterialButton
import com.zalotofb.poster.R
import com.zalotofb.poster.Z2FBApplication
import com.zalotofb.poster.data.models.PostItem
import com.zalotofb.poster.data.models.PostStatus
import com.zalotofb.poster.data.repository.StorageRepository
import com.zalotofb.poster.ui.PostEditorActivity

class FloatingBubbleService : Service() {

    companion object {
        const val EXTRA_POST_ID = "extra_post_id"
        private const val NOTIFICATION_ID = 1001
    }

    private var windowManager: WindowManager? = null
    private var bubbleView: View? = null
    private var previewDialogView: View? = null

    private var currentPostId: String? = null
    private var currentPost: PostItem? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, createForegroundNotification())
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        currentPostId = intent?.getStringExtra(EXTRA_POST_ID)
        loadCurrentPost()

        if (Settings.canDrawOverlays(this)) {
            if (bubbleView == null) {
                initBubbleView()
            } else {
                updateBubbleBadge()
            }
        } else {
            stopSelf()
        }

        return START_NOT_STICKY
    }

    private fun loadCurrentPost() {
        val repo = StorageRepository.getInstance(applicationContext)
        currentPost = if (currentPostId != null) {
            repo.getPosts().find { it.id == currentPostId }
        } else {
            repo.getPosts().firstOrNull { it.status == PostStatus.PENDING }
        }
    }

    private fun initBubbleView() {
        val layoutInflater = LayoutInflater.from(this)
        bubbleView = layoutInflater.inflate(R.layout.floating_bubble_view, null)

        val layoutParamsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutParamsType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 100
            y = 200
        }

        // Kéo thả và bấm vào bong bóng nổi
        bubbleView?.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0
            private var initialY = 0
            private var initialTouchX = 0f
            private var initialTouchY = 0f
            private var isClick = false

            override fun onTouch(v: View?, event: MotionEvent?): Boolean {
                if (event == null) return false
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        isClick = true
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (event.rawX - initialTouchX).toInt()
                        val dy = (event.rawY - initialTouchY).toInt()
                        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                            isClick = false
                        }
                        params.x = initialX + dx
                        params.y = initialY + dy
                        windowManager?.updateViewLayout(bubbleView, params)
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (isClick) {
                            togglePreviewDialog()
                        }
                        return true
                    }
                }
                return false
            }
        })

        windowManager?.addView(bubbleView, params)
        updateBubbleBadge()
    }

    private fun updateBubbleBadge() {
        val repo = StorageRepository.getInstance(applicationContext)
        val pendingCount = repo.getPosts().count { it.status == PostStatus.PENDING }
        val tvBadge = bubbleView?.findViewById<TextView>(R.id.tv_bubble_badge)

        if (pendingCount > 0) {
            tvBadge?.visibility = View.VISIBLE
            tvBadge?.text = pendingCount.toString()
        } else {
            tvBadge?.visibility = View.GONE
            stopSelf() // Tự động đóng bubble nếu không còn bài chờ duyệt
        }
    }

    private fun togglePreviewDialog() {
        if (previewDialogView != null) {
            dismissPreviewDialog()
            return
        }

        loadCurrentPost()
        val post = currentPost ?: return

        val layoutInflater = LayoutInflater.from(this)
        previewDialogView = layoutInflater.inflate(R.layout.floating_preview_dialog, null)

        val layoutParamsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val dialogParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutParamsType,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
        }

        // Gắn dữ liệu bài viết vào Dialog
        previewDialogView?.findViewById<TextView>(R.id.tv_preview_group)?.text = "Nhóm: ${post.zaloGroupName}"
        previewDialogView?.findViewById<TextView>(R.id.tv_preview_text)?.text = post.processedContent.ifBlank { post.originalContent }

        val ivImage = previewDialogView?.findViewById<ImageView>(R.id.iv_preview_image)
        if (post.imageUris.isNotEmpty()) {
            ivImage?.visibility = View.VISIBLE
            Glide.with(this).load(post.imageUris.first()).into(ivImage!!)
        } else {
            ivImage?.visibility = View.GONE
        }

        // Sự kiện các nút bấm
        previewDialogView?.findViewById<ImageButton>(R.id.btn_close_preview)?.setOnClickListener {
            dismissPreviewDialog()
        }

        previewDialogView?.findViewById<MaterialButton>(R.id.btn_preview_dismiss)?.setOnClickListener {
            dismissPreviewDialog()
        }

        previewDialogView?.findViewById<MaterialButton>(R.id.btn_preview_edit)?.setOnClickListener {
            dismissPreviewDialog()
            val editIntent = Intent(this, PostEditorActivity::class.java).apply {
                putExtra(PostEditorActivity.EXTRA_POST_ID, post.id)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(editIntent)
        }

        previewDialogView?.findViewById<MaterialButton>(R.id.btn_preview_approve)?.setOnClickListener {
            // Duyệt và xếp hàng đăng ngay
            val repo = StorageRepository.getInstance(applicationContext)
            repo.updatePostStatus(post.id, PostStatus.QUEUED)

            val workData = workDataOf(FacebookPostWorker.KEY_POST_ID to post.id)
            val request = OneTimeWorkRequestBuilder<FacebookPostWorker>()
                .setInputData(workData)
                .build()
            WorkManager.getInstance(applicationContext).enqueue(request)

            dismissPreviewDialog()
            updateBubbleBadge()
        }

        windowManager?.addView(previewDialogView, dialogParams)
    }

    private fun dismissPreviewDialog() {
        if (previewDialogView != null) {
            windowManager?.removeView(previewDialogView)
            previewDialogView = null
        }
    }

    private fun createForegroundNotification(): Notification {
        return NotificationCompat.Builder(this, Z2FBApplication.CHANNEL_SERVICE_ID)
            .setSmallIcon(R.drawable.ic_bubble)
            .setContentTitle("Z2FB Post Manager Đang Chạy")
            .setContentText("Bong bóng nổi đang sẵn sàng để duyệt bài nhanh")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        dismissPreviewDialog()
        if (bubbleView != null) {
            windowManager?.removeView(bubbleView)
            bubbleView = null
        }
    }
}
