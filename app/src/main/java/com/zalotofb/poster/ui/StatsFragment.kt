package com.zalotofb.poster.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.zalotofb.poster.data.local.AppDatabase
import com.zalotofb.poster.data.local.entity.LeadEntity
import com.zalotofb.poster.databinding.FragmentStatsBinding
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class StatsFragment : Fragment() {

    private var _binding: FragmentStatsBinding? = null
    private val binding get() = _binding!!

    private lateinit var db: AppDatabase

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentStatsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        db = AppDatabase.getInstance(requireContext())

        binding.btnAddLead.setOnClickListener {
            showAddLeadDialog()
        }

        binding.btnExportCsv.setOnClickListener {
            exportDataToCsv()
        }

        loadStats()
    }

    private fun showAddLeadDialog() {
        val layout = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 16, 32, 16)
        }
        val etPhone = EditText(requireContext()).apply { hint = "Số điện thoại khách gọi" }
        val etNote = EditText(requireContext()).apply { hint = "Ghi chú (nhu cầu, tài chính...)" }
        layout.addView(etPhone)
        layout.addView(etNote)

        AlertDialog.Builder(requireContext())
            .setTitle("+ Ghi nhận khách gọi (Lead)")
            .setView(layout)
            .setPositiveButton("Lưu") { _, _ ->
                val phone = etPhone.text.toString().trim()
                val note = etNote.text.toString().trim()
                if (phone.isBlank()) return@setPositiveButton

                lifecycleScope.launch {
                    val lead = LeadEntity(
                        id = UUID.randomUUID().toString(),
                        phone = phone,
                        listingId = null,
                        groupId = null,
                        note = note.ifBlank { null },
                        createdAt = System.currentTimeMillis()
                    )
                    db.leadDao().insert(lead)
                    Toast.makeText(requireContext(), "Đã ghi nhận khách gọi!", Toast.LENGTH_SHORT).show()
                    loadStats()
                }
            }
            .setNegativeButton("Hủy", null)
            .show()
    }

    private fun loadStats() {
        lifecycleScope.launch {
            val allPosts = db.postLogDao().observeAll().first()
            val allLeads = db.leadDao().observeAll().first()

            binding.tvTotalPosts.text = "${allPosts.size}"
            binding.tvTotalLeads.text = "${allLeads.size}"
        }
    }

    private fun exportDataToCsv() {
        lifecycleScope.launch {
            val leads = db.leadDao().observeAll().first()
            val posts = db.postLogDao().observeAll().first()

            val csvFile = File(requireContext().cacheDir, "chdv_report_${System.currentTimeMillis()}.csv")
            FileOutputStream(csvFile).bufferedWriter(Charsets.UTF_8).use { writer ->
                writer.write("LEADS REPORT\n")
                writer.write("ID,Phone,Note,CreatedAt\n")
                for (l in leads) {
                    writer.write("${l.id},${l.phone},\"${l.note ?: ""}\",${l.createdAt}\n")
                }
                writer.write("\nPOSTS REPORT\n")
                writer.write("ID,ListingID,GroupID,PostedAt\n")
                for (p in posts) {
                    writer.write("${p.id},${p.listingId},${p.groupId},${p.postedAt}\n")
                }
            }

            val uri = FileProvider.getUriForFile(
                requireContext(),
                "${requireContext().packageName}.fileprovider",
                csvFile
            )
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/csv"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(shareIntent, "Xuất báo cáo CSV"))
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
