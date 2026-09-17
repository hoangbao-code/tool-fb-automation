package com.zalotofb.poster.ui.adapters

import android.content.Intent
import android.net.Uri
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
    private var allPosts: List<PostItem>,
    private val onPostNowClick: (PostItem) -> Unit,
    private val onEditClick: (PostItem) -> Unit,
    private val onDeleteClick: (PostItem) -> Unit
) : RecyclerView.Adapter<PostAdapter.PostViewHolder>() {

    private var displayedPosts: List<PostItem> = allPosts
    private val dateFormat = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault())

    fun updateData(newPosts: List<PostItem>) {
        this.allPosts = newPosts
        this.displayedPosts = newPosts
        notifyDataSetChanged()
    }

    fun filterByStatus(status: PostStatus?) {
        displayedPosts = if (status == null) {
            allPosts
        } else {
            allPosts.filter { it.status == status }
        }
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): PostViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_post, parent, false)
        return PostViewHolder(view)
    }

    override fun onBindViewHolder(holder: PostViewHolder, position: Int) {
        holder.bind(displayedPosts[position])
    }

    override fun getItemCount(): Int = displayedPosts.size

    inner class PostViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val tvChipRoomType: TextView = itemView.findViewById(R.id.tv_chip_room_type)
        private val tvChipDistrict: TextView = itemView.findViewById(R.id.tv_chip_district)
        private val tvRoomPrice: TextView = itemView.findViewById(R.id.tv_room_price)
        private val tvStatusBadge: TextView = itemView.findViewById(R.id.tv_status_badge)
        private val tvPostTime: TextView = itemView.findViewById(R.id.tv_post_time)
        private val tvGroupSource: TextView = itemView.findViewById(R.id.tv_group_source)
        private val ivThumbnail: ImageView = itemView.findViewById(R.id.iv_thumbnail)
        private val tvCaptionPreview: TextView = itemView.findViewById(R.id.tv_caption_preview)
        private val tvTargetGroups: TextView = itemView.findViewById(R.id.tv_target_groups_count)
        private val btnPostNow: MaterialButton = itemView.findViewById(R.id.btn_post_now)
        private val btnEdit: ImageButton = itemView.findViewById(R.id.btn_edit_post)
        private val btnDelete: ImageButton = itemView.findViewById(R.id.btn_delete_post)

        fun bind(post: PostItem) {
            tvChipRoomType.text = post.roomType
            tvChipDistrict.text = post.district
            tvRoomPrice.text = post.price
            tvGroupSource.text = "Nguồn: ${post.zaloGroupName.ifBlank { "Zalo" }}"
            tvPostTime.text = dateFormat.format(Date(post.createdAt))
            tvCaptionPreview.text = post.processedContent.ifBlank { post.originalContent }

            when (post.status) {
                PostStatus.PENDING -> {
                    tvStatusBadge.text = "Chờ duyệt"
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.badge_pending_text))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.badge_pending))
                    btnPostNow.isEnabled = true
                    btnPostNow.text = "🚀 Duyệt & Đăng Ngay"
                }
                PostStatus.QUEUED -> {
                    tvStatusBadge.text = "Đang đợi đăng"
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.primary))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.primary_container))
                    btnPostNow.isEnabled = false
                    btnPostNow.text = "⏳ Trong hàng đợi..."
                }
                PostStatus.POSTING -> {
                    tvStatusBadge.text = "Đang đăng..."
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.primary))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.primary_container))
                    btnPostNow.isEnabled = false
                    btnPostNow.text = "🔄 Đang tải lên nhóm..."
                }
                PostStatus.POSTED -> {
                    tvStatusBadge.text = "Đã đăng xong"
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.badge_posted_text))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.badge_posted))
                    btnPostNow.isEnabled = true
                    btnPostNow.text = if (!post.fbPostUrl.isNullOrBlank()) "🔗 Mở bài trên Facebook" else "🔄 Đăng lại"
                }
                PostStatus.FAILED -> {
                    tvStatusBadge.text = "Lỗi đăng bài"
                    tvStatusBadge.setTextColor(ContextCompat.getColor(itemView.context, R.color.badge_failed_text))
                    tvStatusBadge.setBackgroundColor(ContextCompat.getColor(itemView.context, R.color.badge_failed))
                    btnPostNow.isEnabled = true
                    btnPostNow.text = "⚠️ Thử lại"
                }
            }

            if (post.imageUris.isNotEmpty()) {
                ivThumbnail.visibility = View.VISIBLE
                Glide.with(itemView.context)
                    .load(post.imageUris.first())
                    .centerCrop()
                    .into(ivThumbnail)
            } else {
                ivThumbnail.visibility = View.GONE
            }

            val groupCount = if (post.targetGroupIds.isNotEmpty()) post.targetGroupIds.size else 5
            tvTargetGroups.text = "🎯 Đích đến: $groupCount Nhóm Facebook BĐS"

            btnPostNow.setOnClickListener {
                if (post.status == PostStatus.POSTED && !post.fbPostUrl.isNullOrBlank()) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(post.fbPostUrl)).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        itemView.context.startActivity(intent)
                    } catch (e: Exception) {
                        onPostNowClick(post)
                    }
                } else {
                    onPostNowClick(post)
                }
            }

            btnEdit.setOnClickListener { onEditClick(post) }
            btnDelete.setOnClickListener { onDeleteClick(post) }
        }
    }
}\n