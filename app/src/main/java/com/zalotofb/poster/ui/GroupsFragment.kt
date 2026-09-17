package com.zalotofb.poster.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.zalotofb.poster.data.local.AppDatabase
import com.zalotofb.poster.data.local.entity.FbGroupEntity
import com.zalotofb.poster.databinding.FragmentGroupsBinding
import com.zalotofb.poster.ui.adapters.GroupAdapter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.UUID

class GroupsFragment : Fragment() {

    private var _binding: FragmentGroupsBinding? = null
    private val binding get() = _binding!!

    private lateinit var db: AppDatabase
    private lateinit var adapter: GroupAdapter
    private var allGroupsList: List<FbGroupEntity> = emptyList()

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentGroupsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        db = AppDatabase.getInstance(requireContext())

        setupRecyclerView()
        setupListeners()
        observeGroups()
    }

    private fun setupRecyclerView() {
        adapter = GroupAdapter(
            onToggleSelection = { group ->
                lifecycleScope.launch {
                    db.fbGroupDao().update(group.copy(isActive = !group.isActive))
                }
            },
            onDeleteClick = { group ->
                lifecycleScope.launch {
                    db.fbGroupDao().delete(group)
                    Toast.makeText(requireContext(), "Đã xóa nhóm: ${group.name}", Toast.LENGTH_SHORT).show()
                }
            },
            onOpenUrlClick = { group ->
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(group.url)).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(requireContext(), "Không thể mở liên kết: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        )

        binding.rvGroups.layoutManager = LinearLayoutManager(requireContext())
        binding.rvGroups.adapter = adapter
    }

    private fun setupListeners() {
        binding.btnAddGroup.setOnClickListener {
            showAddGroupDialog()
        }

        binding.btnAutoDetect.setOnClickListener {
            showBulkImportDialog()
        }

        binding.btnSelectAllGroups.setOnClickListener {
            lifecycleScope.launch {
                val current = db.fbGroupDao().observeAll().first()
                val updated = current.map { it.copy(isActive = true) }
                db.fbGroupDao().insertAll(updated)
            }
        }

        binding.btnDeselectAllGroups.setOnClickListener {
            lifecycleScope.launch {
                val current = db.fbGroupDao().observeAll().first()
                val updated = current.map { it.copy(isActive = false) }
                db.fbGroupDao().insertAll(updated)
            }
        }

        binding.etSearchGroups.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
                filterGroups(s?.toString() ?: "")
            }
            override fun afterTextChanged(s: Editable?) {}
        })
    }

    private fun filterGroups(query: String) {
        if (query.isBlank()) {
            adapter.submitList(allGroupsList)
        } else {
            val q = query.lowercase().trim()
            val filtered = allGroupsList.filter {
                it.name.lowercase().contains(q) ||
                (it.districtTag?.lowercase()?.contains(q) == true) ||
                it.trackingCode.lowercase().contains(q) ||
                it.url.lowercase().contains(q)
            }
            adapter.submitList(filtered)
        }
    }

    private fun showAddGroupDialog() {
        val inputUrl = EditText(requireContext()).apply {
            hint = "https://www.facebook.com/groups/..."
        }

        AlertDialog.Builder(requireContext())
            .setTitle("Thêm nhóm Facebook")
            .setView(inputUrl)
            .setPositiveButton("Thêm") { _, _ ->
                val url = inputUrl.text.toString().trim()
                if (url.isBlank()) return@setPositiveButton

                lifecycleScope.launch {
                    val existing = db.fbGroupDao().findByUrl(url)
                    if (existing != null) {
                        Toast.makeText(requireContext(), "Nhóm này đã có trong danh sách!", Toast.LENGTH_SHORT).show()
                        return@launch
                    }

                    val slug = ShareAssistManager.extractGroupIdOrSlug(url)
                    val allGroups = db.fbGroupDao().observeAll().first()
                    val existingCodes = allGroups.map { it.trackingCode }.toSet()

                    val district = ShareAssistManager.suggestDistrictTag(slug)
                    val trackingCode = ShareAssistManager.generateTrackingCode(district, existingCodes)

                    val newGroup = FbGroupEntity(
                        id = UUID.randomUUID().toString(),
                        name = "Nhóm $slug",
                        url = url,
                        districtTag = district,
                        trackingCode = trackingCode,
                        postLimitPerDay = 1,
                        isActive = true
                    )
                    db.fbGroupDao().insert(newGroup)
                    Toast.makeText(requireContext(), "Đã thêm nhóm thành công!", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Hủy", null)
            .show()
    }

    private fun showBulkImportDialog() {
        val inputBulk = EditText(requireContext()).apply {
            hint = "Dán nhiều dòng:\nTên nhóm 1 | https://facebook.com/groups/...\nhttps://facebook.com/groups/..."
            minLines = 5
        }

        AlertDialog.Builder(requireContext())
            .setTitle("Nhập hàng loạt nhóm Facebook")
            .setView(inputBulk)
            .setPositiveButton("Nhập") { _, _ ->
                val content = inputBulk.text.toString()
                if (content.isBlank()) return@setPositiveButton

                lifecycleScope.launch {
                    val allGroups = db.fbGroupDao().observeAll().first()
                    val existingCodes = allGroups.map { it.trackingCode }.toMutableSet()
                    val parsed = ShareAssistManager.parseBulkGroups(content, existingCodes)

                    val entities = parsed.map { (name, url) ->
                        val district = ShareAssistManager.suggestDistrictTag(name)
                        val code = ShareAssistManager.generateTrackingCode(district, existingCodes)
                        existingCodes.add(code)
                        FbGroupEntity(
                            id = UUID.randomUUID().toString(),
                            name = name,
                            url = url,
                            districtTag = district,
                            trackingCode = code,
                            postLimitPerDay = 1,
                            isActive = true
                        )
                    }

                    db.fbGroupDao().insertAll(entities)
                    Toast.makeText(requireContext(), "Đã nhập ${entities.size} nhóm thành công!", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Hủy", null)
            .show()
    }

    private fun observeGroups() {
        lifecycleScope.launch {
            db.fbGroupDao().observeAll().collect { list ->
                allGroupsList = list
                val activeCount = list.count { it.isActive }
                binding.tvGroupsSelectedCount.text = "Đã kích hoạt: $activeCount / ${list.size} nhóm"
                filterGroups(binding.etSearchGroups.text?.toString() ?: "")
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
