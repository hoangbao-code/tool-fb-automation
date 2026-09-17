package com.zalotofb.poster.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.bumptech.glide.Glide
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
    private lateinit var imageAdapter: ImageThumbAdapter
    private val selectedImages = mutableListOf<String>()

    // Launcher chọn nhiều ảnh từ Thư viện (Gallery)
    private val pickImagesLauncher = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris: List<Uri> ->
        if (uris.isNotEmpty()) {
            uris.forEach { uri ->
                val uriStr = uri.toString()
                if (!selectedImages.contains(uriStr)) {
                    selectedImages.add(uriStr)
                }
            }
            imageAdapter.notifyDataSetChanged()
            Toast.makeText(this, "Đã thêm ${uris.size} ảnh căn hộ!", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_post_editor)

        repository = StorageRepository.getInstance(this)
        sessionManager = FacebookSessionManager.getInstance(this)

        val toolbar: MaterialToolbar = findViewById(R.id.toolbar_editor)
        toolbar.setNavigationOnClickListener { finish() }

        etCaption = findViewById(R.id.et_caption)
        val btnApplyRules: MaterialButton = findViewById(R.id.btn_apply_rules)
        val btnPasteClip: MaterialButton = findViewById(R.id.btn_paste_clipboard)
        val btnPickImages: MaterialButton = findViewById(R.id.btn_pick_images)
        val rvImages: RecyclerView = findViewById(R.id.rv_editor_images)
        val btnSaveDraft: MaterialButton = findViewById(R.id.btn_editor_save_draft)
        val btnPostNow: MaterialButton = findViewById(R.id.btn_editor_post_now)
        val rvGroups: RecyclerView = findViewById(R.id.rv_editor_groups)

        val postId = intent.getStringExtra(EXTRA_POST_ID)
        currentPost = if (postId != null) {
            repository.getPosts().find { it.id == postId }
        } else {
            PostItem(
                id = UUID.randomUUID().toString(),
                zaloGroupName = "Nhập phòng thủ công",
                originalContent = "",
                processedContent = ""
            )
        }

        val post = currentPost!!
        etCaption.setText(post.processedContent.ifBlank { post.originalContent })
        selectedImages.addAll(post.imageUris)

        // RecyclerView Ảnh xem trước
        rvImages.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        imageAdapter = ImageThumbAdapter(selectedImages) { removedIndex ->
            selectedImages.removeAt(removedIndex)
            imageAdapter.notifyDataSetChanged()
        }
        rvImages.adapter = imageAdapter

        // Nút chọn ảnh từ Thư viện
        btnPickImages.setOnClickListener {
            pickImagesLauncher.launch("image/*")
        }

        // Nút dán từ Clipboard
        btnPasteClip.setOnClickListener {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val item = clipboard.primaryClip?.getItemAt(0)
            val pasteText = item?.text?.toString() ?: ""
            if (pasteText.isNotBlank()) {
                etCaption.setText(pasteText)
                Toast.makeText(this, "Đã dán nội dung từ Zalo!", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "Khay nhớ tạm trống!", Toast.LENGTH_SHORT).show()
            }
        }

        // Nút AI Viết lại
        btnApplyRules.setOnClickListener {
            val settings = repository.getSettings()
            val text = etCaption.text.toString()
            if (text.isBlank()) {
                Toast.makeText(this, "Vui lòng nhập nội dung trước khi bấm AI Viết Lại!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val filtered = ContentFilterEngine.processContent(text, settings)
            etCaption.setText(filtered)
            Toast.makeText(this, "🤖 AI đã chuẩn hóa form CHDV & lọc hoa hồng!", Toast.LENGTH_SHORT).show()
        }

        // Cấu hình danh sách Group Facebook
        rvGroups.layoutManager = LinearLayoutManager(this)
        groupAdapter = GroupAdapter(
            allGroups = repository.getFacebookGroups(),
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
        post.imageUris.clear()
        post.imageUris.addAll(selectedImages)
        post.roomType = ContentFilterEngine.extractRoomType(text)
        post.district = ContentFilterEngine.extractDistrict(text)
        post.price = ContentFilterEngine.extractPrice(text)
        val selectedGroupIds = repository.getFacebookGroups().filter { it.isSelected }.map { it.id }
        post.targetGroupIds = selectedGroupIds.toMutableList()
        repository.savePost(post)
    }

    // Adapter hiển thị ảnh thumbnail bo góc trong màn hình editor
    private class ImageThumbAdapter(
        private val images: List<String>,
        private val onRemoveClick: (Int) -> Unit
    ) : RecyclerView.Adapter<ImageThumbAdapter.ThumbViewHolder>() {

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ThumbViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_editor_image, parent, false)
            return ThumbViewHolder(view)
        }

        override fun onBindViewHolder(holder: ThumbViewHolder, position: Int) {
            val uriStr = images[position]
            Glide.with(holder.itemView.context).load(uriStr).centerCrop().into(holder.ivThumb)
            holder.btnRemove.setOnClickListener { onRemoveClick(position) }
        }

        override fun getItemCount(): Int = images.size

        class ThumbViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
            val ivThumb: ImageView = itemView.findViewById(R.id.iv_editor_thumb)
            val btnRemove: View = itemView.findViewById(R.id.btn_remove_thumb)
        }
    }
}
