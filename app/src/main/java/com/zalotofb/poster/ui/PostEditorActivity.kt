package com.zalotofb.poster.ui

import android.os.Bundle
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.zalotofb.poster.R
import com.zalotofb.poster.data.models.PostItem
import com.zalotofb.poster.data.models.PostStatus
import com.zalotofb.poster.data.repository.StorageRepository
import com.zalotofb.poster.engine.ContentFilterEngine
import com.zalotofb.poster.facebook.FacebookSessionManager
import com.zalotofb.poster.facebook.FacebookUploader
import com.zalotofb.poster.services.FacebookPostWorker
import com.zalotofb.poster.ui.adapters.GroupAdapter
import java.util.UUID

class PostEditorActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_POST_ID = "extra_post_id"
    }

    private lateinit var repository: StorageRepository
    private lateinit var sessionManager: FacebookSessionManager

    private var currentPost: PostItem? = null
    private lateinit var etCaption: EditText
    private lateinit var groupAdapter: GroupAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_post_editor)

        repository = StorageRepository.getInstance(this)
        sessionManager = FacebookSessionManager.getInstance(this)

        val toolbar: MaterialToolbar = findViewById(R.id.toolbar_editor)
        toolbar.setNavigationOnClickListener { finish() }

        etCaption = findViewById(R.id.et_caption)
        val btnApplyRules: MaterialButton = findViewById(R.id.btn_apply_rules)
        val btnSaveDraft: MaterialButton = findViewById(R.id.btn_editor_save_draft)
        val btnPostNow: MaterialButton = findViewById(R.id.btn_editor_post_now)
        val rvGroups: RecyclerView = findViewById(R.id.rv_editor_groups)

        val postId = intent.getStringExtra(EXTRA_POST_ID)
        currentPost = if (postId != null) {
            repository.getPosts().find { it.id == postId }
        } else {
            PostItem(
                id = UUID.randomUUID().toString(),
                zaloGroupName = "Nhập thủ công",
                originalContent = "",
                processedContent = ""
            )
        }

        val post = currentPost!!
        etCaption.setText(post.processedContent.ifBlank { post.originalContent })

        btnApplyRules.setOnClickListener {
            val settings = repository.getSettings()
            val text = etCaption.text.toString()
            val filtered = ContentFilterEngine.processContent(text, settings)
            etCaption.setText(filtered)
            Toast.makeText(this, "Đã áp dụng mẫu AI CHDV & lọc hoa hồng!", Toast.LENGTH_SHORT).show()
        }

        // Cấu hình danh sách Group Facebook
        rvGroups.layoutManager = LinearLayoutManager(this)
        groupAdapter = GroupAdapter(
            groups = repository.getFacebookGroups(),
            onToggleSelect = { group, isSelected ->
                repository.saveFacebookGroup(group)
            },
            onDeleteGroup = { group ->
                repository.deleteFacebookGroup(group.id)
                groupAdapter.updateData(repository.getFacebookGroups())
            }
        )
        rvGroups.adapter = groupAdapter

        btnSaveDraft.setOnClickListener {
            saveCurrentPost(PostStatus.PENDING)
            Toast.makeText(this, "Đã lưu bản nháp!", Toast.LENGTH_SHORT).show()
            finish()
        }

        btnPostNow.setOnClickListener {
            if (!sessionManager.isLoggedIn()) {
                // Nếu chưa có Cookie Facebook, hỏi người dùng có muốn mở trực tiếp App Facebook không
                FacebookUploader.shareViaOfficialFacebookApp(this, post)
                return@setOnClickListener
            }

            saveCurrentPost(PostStatus.QUEUED)
            val workData = workDataOf(FacebookPostWorker.KEY_POST_ID to post.id)
            val request = OneTimeWorkRequestBuilder<FacebookPostWorker>()
                .setInputData(workData)
                .build()
            WorkManager.getInstance(this).enqueue(request)

            Toast.makeText(this, "Đã xếp hàng đăng bài lên Facebook!", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    private fun saveCurrentPost(status: PostStatus) {
        val post = currentPost ?: return
        val text = etCaption.text.toString().trim()
        post.processedContent = text
        post.status = status
        post.roomType = ContentFilterEngine.extractRoomType(text)
        post.district = ContentFilterEngine.extractDistrict(text)
        post.price = ContentFilterEngine.extractPrice(text)
        val selectedGroupIds = repository.getFacebookGroups().filter { it.isSelected }.map { it.id }
        post.targetGroupIds = selectedGroupIds.toMutableList()
        repository.savePost(post)
    }
}
