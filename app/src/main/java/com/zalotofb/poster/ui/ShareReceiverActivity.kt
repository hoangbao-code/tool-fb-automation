package com.zalotofb.poster.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.zalotofb.poster.data.models.PostItem
import com.zalotofb.poster.data.models.PostStatus
import com.zalotofb.poster.data.repository.StorageRepository
import com.zalotofb.poster.engine.ContentFilterEngine
import java.util.UUID

class ShareReceiverActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        handleIncomingShareIntent(intent)
        finish()
    }

    private fun handleIncomingShareIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        val type = intent.type ?: ""

        val repository = StorageRepository.getInstance(this)
        val settings = repository.getSettings()

        var textContent = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
        val imageUris = mutableListOf<String>()

        if (Intent.ACTION_SEND == action) {
            if (type.startsWith("image/")) {
                val imageUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                }
                imageUri?.let { imageUris.add(it.toString()) }
            }
        } else if (Intent.ACTION_SEND_MULTIPLE == action) {
            if (type.startsWith("image/")) {
                val uris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                }
                uris?.forEach { imageUris.add(it.toString()) }
            }
        }

        if (textContent.isBlank() && imageUris.isEmpty()) {
            Toast.makeText(this, "Không tìm thấy nội dung bài viết từ Zalo để nạp!", Toast.LENGTH_SHORT).show()
            return
        }

        // Tự động áp dụng quy tắc lọc (Thay SĐT, chữ ký)
        val processedContent = ContentFilterEngine.processContent(textContent, settings)

        val newPost = PostItem(
            id = UUID.randomUUID().toString(),
            zaloGroupName = "Chia sẻ từ Zalo",
            senderName = "Tôi",
            originalContent = textContent,
            processedContent = processedContent,
            imageUris = imageUris,
            createdAt = System.currentTimeMillis(),
            status = PostStatus.PENDING
        )

        repository.savePost(newPost)
        Toast.makeText(this, "Đã nạp bài từ Zalo vào Z2FB Manager thành công!", Toast.LENGTH_SHORT).show()

        // Mở thẳng màn hình chỉnh sửa bài viết để duyệt/sửa
        val editorIntent = Intent(this, PostEditorActivity::class.java).apply {
            putExtra(PostEditorActivity.EXTRA_POST_ID, newPost.id)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(editorIntent)
    }
}
