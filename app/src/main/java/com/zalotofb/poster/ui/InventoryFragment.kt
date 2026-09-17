package com.zalotofb.poster.ui

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.snackbar.Snackbar
import com.zalotofb.poster.data.local.AppDatabase
import com.zalotofb.poster.data.local.PreferenceStorage
import com.zalotofb.poster.data.local.entity.ListingEntity
import com.zalotofb.poster.data.repository.ListingRepository
import com.zalotofb.poster.databinding.FragmentInventoryBinding
import com.zalotofb.poster.domain.model.ListingStatus
import com.zalotofb.poster.domain.model.Source
import com.zalotofb.poster.ui.adapters.ListingAdapter
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class InventoryFragment : Fragment() {

    private var _binding: FragmentInventoryBinding? = null
    private val binding get() = _binding!!

    private lateinit var repository: ListingRepository
    private lateinit var adapter: ListingAdapter
    private var currentFilter: ListingStatus? = null

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentInventoryBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val context = requireContext()
        val db = AppDatabase.getInstance(context)
        val prefs = PreferenceStorage(context)
        repository = ListingRepository(db, prefs)

        setupRecyclerView()
        setupListeners()
        observeListings()
    }

    private fun setupRecyclerView() {
        adapter = ListingAdapter(
            onEditClick = { listing ->
                val intent = Intent(requireContext(), PostEditorActivity::class.java).apply {
                    putExtra(PostEditorActivity.EXTRA_LISTING_ID, listing.id)
                }
                startActivity(intent)
            },
            onDeleteClick = { listing ->
                lifecycleScope.launch {
                    repository.deleteListing(listing)
                    Snackbar.make(binding.root, "Đã xóa tin phòng", Snackbar.LENGTH_LONG)
                        .setAction("Hoàn tác") {
                            lifecycleScope.launch {
                                repository.updateListing(listing)
                            }
                        }.show()
                }
            },
            onPostClick = { listing ->
                (activity as? MainActivity)?.openPostSessionWithListing(listing.id)
            }
        )

        binding.rvListings.layoutManager = LinearLayoutManager(requireContext())
        binding.rvListings.adapter = adapter
    }

    private fun setupListeners() {
        binding.btnPasteListing.setOnClickListener {
            val clipboard = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clipData = clipboard.primaryClip
            val text = clipData?.getItemAt(0)?.text?.toString()
            if (text.isNullOrBlank()) {
                Toast.makeText(requireContext(), "Clipboard trống!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            lifecycleScope.launch {
                val newListing = repository.ingestRawListing(
                    rawText = text,
                    source = Source.PASTE
                )
                Toast.makeText(requireContext(), "Đã nạp tin từ clipboard!", Toast.LENGTH_SHORT).show()
                val intent = Intent(requireContext(), PostEditorActivity::class.java).apply {
                    putExtra(PostEditorActivity.EXTRA_LISTING_ID, newListing.id)
                }
                startActivity(intent)
            }
        }

        binding.btnNewListing.setOnClickListener {
            val intent = Intent(requireContext(), PostEditorActivity::class.java)
            startActivity(intent)
        }

        binding.chipGroupStatus.setOnCheckedStateChangeListener { _, checkedIds ->
            currentFilter = when (checkedIds.firstOrNull()) {
                binding.chipDraft.id -> ListingStatus.DRAFT
                binding.chipReady.id -> ListingStatus.READY
                binding.chipListed.id -> ListingStatus.LISTED
                binding.chipRented.id -> ListingStatus.RENTED
                else -> null
            }
            observeListings()
        }
    }

    private fun observeListings() {
        lifecycleScope.launch {
            val flow = if (currentFilter == null) {
                repository.observeAll()
            } else {
                repository.observeByStatus(currentFilter!!)
            }

            flow.collectLatest { list ->
                adapter.submitList(list)
                binding.layoutEmptyState.visibility = if (list.isEmpty()) View.VISIBLE else View.GONE
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
