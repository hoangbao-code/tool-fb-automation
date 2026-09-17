package com.zalotofb.poster.ui.adapters

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
    private var groups: List<FacebookGroup>,
    private val onToggleSelect: (FacebookGroup, Boolean) -> Unit,
    private val onDeleteGroup: (FacebookGroup) -> Unit
) : RecyclerView.Adapter<GroupAdapter.GroupViewHolder>() {

    fun updateData(newGroups: List<FacebookGroup>) {
        this.groups = newGroups
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): GroupViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_group, parent, false)
        return GroupViewHolder(view)
    }

    override fun onBindViewHolder(holder: GroupViewHolder, position: Int) {
        holder.bind(groups[position])
    }

    override fun getItemCount(): Int = groups.size

    inner class GroupViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val cbSelected: MaterialCheckBox = itemView.findViewById(R.id.cb_group_selected)
        private val tvName: TextView = itemView.findViewById(R.id.tv_group_name)
        private val tvDistrictTag: TextView = itemView.findViewById(R.id.tv_group_district_tag)
        private val tvId: TextView = itemView.findViewById(R.id.tv_group_id)
        private val btnDelete: ImageButton = itemView.findViewById(R.id.btn_delete_group)

        fun bind(group: FacebookGroup) {
            tvName.text = group.name
            tvDistrictTag.text = group.districtTag
            tvId.text = "ID: ${group.id}"
            cbSelected.isChecked = group.isSelected

            cbSelected.setOnCheckedChangeListener { _, isChecked ->
                group.isSelected = isChecked
                onToggleSelect(group, isChecked)
            }

            btnDelete.setOnClickListener {
                onDeleteGroup(group)
            }
        }
    }
}
