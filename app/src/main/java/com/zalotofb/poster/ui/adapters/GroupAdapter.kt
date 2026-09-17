package com.zalotofb.poster.ui.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.checkbox.MaterialCheckBox
import com.zalotofb.poster.R
import com.zalotofb.poster.data.local.entity.FbGroupEntity

class GroupAdapter(
    private val onToggleSelection: (FbGroupEntity) -> Unit,
    private val onDeleteClick: (FbGroupEntity) -> Unit,
    private val onOpenUrlClick: (FbGroupEntity) -> Unit
) : ListAdapter<FbGroupEntity, GroupAdapter.ViewHolder>(DIFF_CALLBACK) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_group, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val cbSelected: MaterialCheckBox = itemView.findViewById(R.id.cb_group_selected)
        private val tvName: TextView = itemView.findViewById(R.id.tv_group_name)
        private val tvDistrictTag: TextView = itemView.findViewById(R.id.tv_group_district_tag)
        private val tvId: TextView = itemView.findViewById(R.id.tv_group_id)
        private val btnOpenFb: ImageButton = itemView.findViewById(R.id.btn_open_fb_group)
        private val btnDelete: ImageButton = itemView.findViewById(R.id.btn_delete_group)

        fun bind(group: FbGroupEntity) {
            tvName.text = group.name
            tvDistrictTag.text = group.districtTag ?: "Chung"
            tvId.text = "Mã: ${group.trackingCode} • ${group.url}"

            cbSelected.setOnCheckedChangeListener(null)
            cbSelected.isChecked = group.isActive
            cbSelected.setOnCheckedChangeListener { _, _ ->
                onToggleSelection(group)
            }

            btnOpenFb.setOnClickListener {
                onOpenUrlClick(group)
            }

            btnDelete.setOnClickListener {
                onDeleteClick(group)
            }
        }
    }

    companion object {
        private val DIFF_CALLBACK = object : DiffUtil.ItemCallback<FbGroupEntity>() {
            override fun areItemsTheSame(oldItem: FbGroupEntity, newItem: FbGroupEntity): Boolean {
                return oldItem.id == newItem.id
            }

            override fun areContentsTheSame(oldItem: FbGroupEntity, newItem: FbGroupEntity): Boolean {
                return oldItem == newItem
            }
        }
    }
}
