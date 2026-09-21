package com.example.posthub.input

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.entity.PostEntity
import com.example.posthub.domain.model.PostSource
import com.example.posthub.domain.model.PostStatus
import com.example.posthub.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream

class ShareReceiverActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        AppLog.i("ShareReceiver", "Nhận Intent chia sẻ từ ứng dụng khác: action=${intent?.action}, type=${intent?.type}")

        val action = intent?.action
        val type = intent?.type

        if (Intent.ACTION_SEND == action && type != null) {
            handleSendSingle(intent)
        } else if (Intent.ACTION_SEND_MULTIPLE == action && type != null) {
            handleSendMultiple(intent)
        } else {
            finish()
        }
    }

    private fun handleSendSingle(intent: Intent) {
        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
        val imageUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)

        CoroutineScope(Dispatchers.IO).launch {
            val savedImages = mutableListOf<String>()
            if (imageUri != null) {
                val savedPath = copyUriToInternalStorage(imageUri)
                if (savedPath != null) {
                    savedImages.add(savedPath)
                }
            }

            savePostAndOpenApp(sharedText, savedImages)
        }
    }

    private fun handleSendMultiple(intent: Intent) {
        val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
        val imageUris = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()

        CoroutineScope(Dispatchers.IO).launch {
            val savedImages = mutableListOf<String>()
            for (uri in imageUris) {
                val savedPath = copyUriToInternalStorage(uri)
                if (savedPath != null) {
                    savedImages.add(savedPath)
                }
            }

            savePostAndOpenApp(sharedText, savedImages)
        }
    }

    private suspend fun copyUriToInternalStorage(uri: Uri): String? = withContext(Dispatchers.IO) {
        try {
            val imagesDir = File(filesDir, "zalo_images")
            if (!imagesDir.exists()) imagesDir.mkdirs()

            val fileName = "img_${System.currentTimeMillis()}_${(1000..9999).random()}.jpg"
            val destFile = File(imagesDir, fileName)

            contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(destFile).use { output ->
                    input.copyTo(output)
                }
            }
            AppLog.i("ShareReceiver", "Đã sao chép ảnh an toàn vào bộ nhớ trong: ${destFile.absolutePath}")
            destFile.absolutePath
        } catch (e: Exception) {
            AppLog.e("ShareReceiver", "Lỗi sao chép ảnh từ URI: $uri", e)
            null
        }
    }

    private suspend fun savePostAndOpenApp(text: String, photoPaths: List<String>) = withContext(Dispatchers.Main) {
        val jsonArray = JSONArray()
        photoPaths.forEach { jsonArray.put(it) }

        val db = JammyApp.instance.container.database
        val postEntity = PostEntity(
            rawText = text,
            cleanedText = text,
            finalPostText = text,
            photoPathsJson = jsonArray.toString(),
            source = PostSource.SHARE_TARGET,
            senderOrGroup = "Chia sẻ từ Zalo",
            status = PostStatus.PENDING_REVIEW
        )

        val insertedId = withContext(Dispatchers.IO) {
            db.postDao().insertPost(postEntity)
        }

        AppLog.i("ShareReceiver", "Đã lưu tin mới từ Share Target (ID: $insertedId) với ${photoPaths.size} ảnh.")
        Toast.makeText(this@ShareReceiverActivity, "Jammy đã nhận tin từ Zalo thành công!", Toast.LENGTH_SHORT).show()

        val mainIntent = Intent(this@ShareReceiverActivity, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("EXTRA_NAVIGATE_POST_ID", insertedId)
        }
        startActivity(mainIntent)
        finish()
    }
}
