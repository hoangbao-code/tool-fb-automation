package com.zalotofb.poster.ui.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.zalotofb.poster.R
import com.zalotofb.poster.data.local.entity.ListingEntity
import com.zalotofb.poster.databinding.ItemListingBinding
import com.zalotofb.poster.domain.model.ListingStatus
import com.zalotofb.poster.domain.template.TemplateEngine

class ListingAdapter(
    private val onEditClick: (ListingEntity) -> Unit,
    private val onDeleteClick: (ListingEntity) -> Unit,
    private val onPostClick: (ListingEntity) -> Unit
) : ListAdapter<ListingEntity, ListingAdapter.ViewHolder>(DIFF_CALLBACK) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemListingBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ViewHolder(private val binding: ItemListingBinding) :
        RecyclerView.ViewHolder(binding.root) {

        fun bind(item: ListingEntity) {
            val context = binding.root.context

            // Status Badge
            binding.tvStatusBadge.text = when (item.status) {
                ListingStatus.DRAFT -> "NHÁP"
                ListingStatus.READY -> "SẴN SÀNG"
                ListingStatus.LISTED -> "ĐANG ĐĂNG"
                ListingStatus.RENTED -> "ĐÃ THUÊ"
                ListingStatus.EXPIRED -> "HẾT HẠN"
            }
            val statusColor = when (item.status) {
                ListingStatus.DRAFT -> ContextCompat.getColor(context, R.color.warning)
                ListingStatus.READY -> ContextCompat.getColor(context, R.color.primary)
                ListingStatus.LISTED -> ContextCompat.getColor(context, R.color.secondary)
                ListingStatus.RENTED -> ContextCompat.getColor(context, R.color.text_secondary)
                ListingStatus.EXPIRED -> ContextCompat.getColor(context, R.color.error)
            }
            binding.tvStatusBadge.setBackgroundColor(statusColor)

            // Confidence
            val confPercent = (item.parseConfidence * 100).toInt()
            binding.tvConfidenceBadge.text = "Tin cậy: $confPercent%"

            // Source
            binding.tvSourceTag.text = item.source.name

            // Title & District
            val roomName = item.roomType?.displayName ?: "Căn hộ dịch vụ"
            val district = item.district ?: "TP.HCM"
            binding.tvTitleDistrict.text = "$roomName • $district"

            // Price & Area
            val priceStr = TemplateEngine.formatPrice(item.priceMin, item.priceMax) ?: "Thiếu giá"
            val areaStr = TemplateEngine.formatArea(item.areaM2) ?: "Chưa rõ DT"
            binding.tvPriceArea.text = "$priceStr • $areaStr"

            // Clean preview
            binding.tvCleanPreview.text = item.cleanText

            // Action buttons
            binding.btnEditListing.setOnClickListener { onEditClick(item) }
            binding.btnDeleteListing.setOnClickListener { onDeleteClick(item) }
            binding.btnPostNow.setOnClickListener { onPostClick(item) }
            binding.root.setOnClickListener { onEditClick(item) }
        }
    }

    companion object {
        private val DIFF_CALLBACK = object : DiffUtil.ItemCallback<ListingEntity>() {
            override fun areItemsTheSame(oldItem: ListingEntity, newItem: ListingEntity): Boolean =
                oldItem.id == newItem.id

            override fun areContentsTheSame(oldItem: ListingEntity, newItem: ListingEntity): Boolean =
                oldItem == newItem
        }
    }
}
