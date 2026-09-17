package com.zalotofb.poster.ui.adapters

import android.content.Intent
import android.net.Uri
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.checkbox.MaterialCheckBox
import com.zalotofb.poster.R
import com.zalotofb.poster.data.models.FacebookGroup

class GroupAdapter(
    private var allGroups: List<FacebookGroup>,
    private val onToggleSelect: (FacebookGroup, Boolean) -> Unit,
    private val onDeleteGroup: (FacebookGroup) -> Unit
) : RecyclerView.Adapter<GroupAdapter.GroupViewHolder>() {

    private var displayedGroups: List<FacebookGroup> = allGroups

    fun updateData(newGroups: List<FacebookGroup>) {
        this.allGroups = newGroups
        this.displayedGroups = newGroups
        notifyDataSetChanged()
    }

    fun filter(query: String) {
        displayedGroups = if (query.isBlank()) {
            allGroups
        } else {
            val q = query.lowercase().trim()
            allGroups.filter {
                it.name.lowercase().contains(q) ||
                it.districtTag.lowercase().contains(q) ||
                it.id.contains(q)
            }
        }
        notifyDataSetChanged()
    }

    fun selectAll(select: Boolean) {
        displayedGroups.forEach {
            it.isSelected = select
            onToggleSelect(it, select)
        }
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): GroupViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_group, parent, false)
        return GroupViewHolder(view)
    }

    override fun onBindViewHolder(holder: GroupViewHolder, position: Int) {
        holder.bind(displayedGroups[position])
    }

    override fun getItemCount(): Int = displayedGroups.size

    inner class GroupViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val cbSelected: MaterialCheckBox = itemView.findViewById(R.id.cb_group_selected)
        private val tvName: TextView = itemView.findViewById(R.id.tv_group_name)
        private val tvDistrictTag: TextView = itemView.findViewById(R.id.tv_group_district_tag)
        private val tvId: TextView = itemView.findViewById(R.id.tv_group_id)
        private val btnOpenFb: ImageButton = itemView.findViewById(R.id.btn_open_fb_group)
        private val btnDelete: ImageButton = itemView.findViewById(R.id.btn_delete_group)

        fun bind(group: FacebookGroup) {
            tvName.text = group.name
            tvDistrictTag.text = group.districtTag
            tvId.text = "ID: ${group.id}"

            // Tránh trigger listener khi đang bind
            cbSelected.setOnCheckedChangeListener(null)
            cbSelected.isChecked = group.isSelected

            cbSelected.setOnCheckedChangeListener { _, isChecked ->
                group.isSelected = isChecked
                onToggleSelect(group, isChecked)
            }

            btnOpenFb.setOnClickListener {
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://facebook.com/groups/${group.id}")).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    itemView.context.startActivity(intent)
                } catch (e: Exception) {
                    // ignore
                }
            }

            btnDelete.setOnClickListener {
                onDeleteGroup(group)
            }
        }
    }
}\n