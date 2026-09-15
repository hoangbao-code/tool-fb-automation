package com.zalotofb.poster.ui.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.google.android.material.button.MaterialButton
import com.zalotofb.poster.R
import com.zalotofb.poster.data.models.PostItem
import com.zalotofb.poster.data.models.PostStatus
import java.text.SimpleDateFormat
import java.util.*

class PostAdapter(
    private var posts: List<PostItem>,
    private val onPostNowClick: (PostItem) -> Unit,
    private val onEditClick: (PostItem) -> Unit,
    private val onDeleteClick: (PostItem) -> Unit
) : RecyclerView.Adapter<PostAdapter.PostViewHolder>() {

    private val dateFormat = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault())

    fun updateData(newPosts: List<PostItem>) {
        this.posts = newPosts
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PostViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_post, parent, false)
        return PostViewHolder(view)
    }

    override fun onBindViewHolder(holder: PostViewHolder, position: Int) {
        holder.bind(posts[position])
    }

    override fun getItemCount(): Int = posts.size

    inner class PostViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val tvGroupSource: TextView = itemView.findViewById(R.id.tv_group_source)
        private val tvStatusBadge: TextView = itemView.findViewById(R.id.tv_status_badge)
        private val tvPostTime: TextView = itemView.findViewById(R.id.tv_post_time)
        private val ivThumbnail: ImageView = itemView.findViewById(R.id.iv_thumbnail)
        private val tvCaptionPreview: TextView = itemView.findViewById(R.id.tv_caption_preview)
        private val tvTargetGroups: TextView = itemView.findViewById(R.id.tv_target_groups_count)
        private val btnPostNow: MaterialButton = itemView.findViewById(R.id.btn_post_now)
        private val btnEdit: ImageButton = itemView.findViewById(R.id.btn_edit_post)
        private val btnDelete: ImageButton = itemView.findViewById(R.id.btn_delete_post)

        fun bind(post: PostItem) {
            tvGroupSource.text = "Nhóm Zalo: ${post.zaloGroupName.ifBlank { "Tin nhắn riêng" }}"
            tvPostTime.text = dateFormat.format(Date(post.createdAt))
            tvCaptionPreview.text = post.processedContent.ifBlank { post.originalContent }

            // Badge trạng thái
            when (post.status) {
                PostStatus.PENDING -> {
                    tvStatusBadge.text = "Chờ duyệt"
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.badge_pending_text))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.badge_pending))
                    btnPostNow.isEnabled = true
                    btnPostNow.text = "🚀 Duyệt & Đăng"
                }
                PostStatus.QUEUED -> {
                    tvStatusBadge.text = "Đang đợi đăng"
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.primary))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.primary_container))
                    btnPostNow.isEnabled = false
                    btnPostNow.text = "⏳ Đang trong hàng đợi"
                }
                PostStatus.POSTING -> {
                    tvStatusBadge.text = "Đang đăng..."
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.primary))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.primary_container))
                    btnPostNow.isEnabled = false
                    btnPostNow.text = "🔄 Đang tải lên..."
                }
                PostStatus.POSTED -> {
                    tvStatusBadge.text = "Đã đăng"
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.badge_success_text))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.badge_success))
                    btnPostNow.isEnabled = true
                    btnPostNow.text = "🔄 Đăng lại"
                }
                PostStatus.FAILED -> {
                    tvStatusBadge.text = "Lỗi đăng bài"
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.badge_failed_text))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.badge_failed))
                    btnPostNow.isEnabled = true
                    btnPostNow.text = "⚠️ Thử lại"
                }
            }

            // Ảnh Thumbnail
            if (post.imageUris.isNotEmpty()) {
                ivThumbnail.visibility = View.VISIBLE
                Glide.with(itemView.context)
                    .load(post.imageUris.first())
                    .centerCrop()
                    .into(ivThumbnail)
            } else {
                ivThumbnail.visibility = View.GONE
            }

            val groupCount = if (post.targetGroupIds.isNotEmpty()) post.targetGroupIds.size else 2
            tvTargetGroups.text = "🎯 Đích đến: $groupCount Nhóm Facebook"

            btnPostNow.setOnClickListener { onPostNowClick(post) }
            btnEdit.setOnClickListener { onEditClick(post) }
            btnDelete.setOnClickListener { onDeleteClick(post) }
        }
    }
}
