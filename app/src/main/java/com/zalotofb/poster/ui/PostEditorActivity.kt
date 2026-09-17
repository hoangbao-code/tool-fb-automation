package com.zalotofb.poster.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.view.View
import android.widget.Toast
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.zalotofb.poster.data.local.AppDatabase
import com.zalotofb.poster.data.local.PreferenceStorage
import com.zalotofb.poster.data.local.entity.ListingEntity
import com.zalotofb.poster.data.photo.PhotoProcessor
import com.zalotofb.poster.data.repository.ListingRepository
import com.zalotofb.poster.databinding.ActivityPostEditorBinding
import com.zalotofb.poster.domain.model.ListingStatus
import com.zalotofb.poster.domain.model.RoomType
import com.zalotofb.poster.domain.model.Source
import com.zalotofb.poster.domain.parser.ListingParser
import com.zalotofb.poster.domain.parser.fold1to1
import com.zalotofb.poster.domain.scrubber.ListingScrubber
import com.zalotofb.poster.domain.template.TemplateEngine
import kotlinx.coroutines.launch

class PostEditorActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPostEditorBinding
    private lateinit var db: AppDatabase
    private lateinit var prefs: PreferenceStorage
    private lateinit var repository: ListingRepository

    private var listingId: String? = null
    private var currentListing: ListingEntity? = null

    private val pickPhotosLauncher = registerForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(10)
    ) { uris ->
        if (uris.isNotEmpty()) {
            handleSelectedPhotos(uris)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPostEditorBinding.inflate(layoutInflater)
        setContentView(binding.root)

        db = AppDatabase.getInstance(this)
        prefs = PreferenceStorage(this)
        repository = ListingRepository(db, prefs)

        listingId = intent.getStringExtra(EXTRA_LISTING_ID)

        setupToolbar()
        setupListeners()
        loadListing()
    }

    private fun setupToolbar() {
        binding.toolbarEditor.setNavigationOnClickListener {
            finish()
        }
    }

    private fun setupListeners() {
        binding.btnSaveDraft.setOnClickListener {
            saveListing(ListingStatus.DRAFT)
        }

        binding.btnSaveReady.setOnClickListener {
            validateAndSaveReady()
        }

        binding.btnAddPhotos.setOnClickListener {
            pickPhotosLauncher.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
            )
        }

        // Masked phone click / long click
        binding.tvEditorOwnerPhone.setOnClickListener {
            Toast.makeText(this, "Nhấn giữ để xem số điện thoại chủ nhà", Toast.LENGTH_SHORT).show()
        }
        binding.tvEditorOwnerPhone.setOnLongClickListener {
            val phone = currentListing?.ownerPhone
            if (!phone.isNullOrBlank()) {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("SĐT chủ", phone))
                Toast.makeText(this, "SĐT chủ nhà: $phone (Đã copy)", Toast.LENGTH_LONG).show()
            }
            true
        }
    }

    private fun loadListing() {
        lifecycleScope.launch {
            if (listingId != null) {
                currentListing = repository.getById(listingId!!)
            }

            if (currentListing == null) {
                // New listing empty template
                currentListing = repository.ingestRawListing(
                    rawText = "Nhập nội dung phòng mới tại đây...",
                    source = Source.MANUAL
                )
                listingId = currentListing?.id
            }

            displayListing(currentListing!!)
        }
    }

    private fun displayListing(listing: ListingEntity) {
        // Confidence badge
        val conf = (listing.parseConfidence * 100).toInt()
        binding.tvEditorConfidence.text = "Độ tin cậy: $conf%"

        // Owner phone masked: 090****123
        val rawPhone = listing.ownerPhone
        val maskedPhone = if (!rawPhone.isNullOrBlank() && rawPhone.length >= 7) {
            rawPhone.take(3) + "****" + rawPhone.takeLast(3)
        } else {
            rawPhone ?: "Không có"
        }
        binding.tvEditorOwnerPhone.text = "SĐT chủ: $maskedPhone"

        // Commission note
        binding.tvEditorCommissionNote.text = "Hoa hồng nội bộ: ${listing.commissionNote ?: "Không phát hiện"}"

        // Fields
        binding.etDistrict.setText(listing.district ?: "")
        binding.etRoomType.setText(listing.roomType?.displayName ?: "")

        // 1. SPLIT SCREEN: LEFT / TOP: Highlight raw text with removed spans
        val scrubResult = ListingScrubber.scrub(listing.rawText)
        val ssb = SpannableStringBuilder(listing.rawText)
        for (span in scrubResult.removedSpans) {
            val s = span.start.coerceIn(0, ssb.length)
            val e = span.end.coerceIn(0, ssb.length)
            if (s < e) {
                ssb.setSpan(
                    BackgroundColorSpan(Color.parseColor("#FFCDD2")),
                    s, e,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
                ssb.setSpan(
                    ForegroundColorSpan(Color.parseColor("#B71C1C")),
                    s, e,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
                ssb.setSpan(
                    StrikethroughSpan(),
                    s, e,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
            }
        }
        binding.tvRawHighlighted.text = ssb

        // 2. SPLIT SCREEN: RIGHT / BOTTOM: Rendered Text
        binding.etRenderedText.setText(listing.renderedText)
    }

    private fun validateAndSaveReady() {
        val rendered = binding.etRenderedText.text.toString()

        // HARD SAFETY CHECK
        val hasCommission = ListingScrubber.hasCommission(rendered)
        val phones = ListingScrubber.extractPhones(rendered)
        val brokerHotline = prefs.hotline
        val unauthorizedPhones = phones.filter { it != brokerHotline }

        if (hasCommission || unauthorizedPhones.isNotEmpty()) {
            binding.bannerSafetyViolation.visibility = View.VISIBLE
            val details = mutableListOf<String>()
            if (hasCommission) details.add("Vẫn còn từ khóa hoa hồng nội bộ")
            if (unauthorizedPhones.isNotEmpty()) details.add("Vẫn còn số điện thoại: ${unauthorizedPhones.joinToString(", ")}")

            binding.tvSafetyViolationMsg.text = "CẢNH BÁO AN TOÀN: ${details.joinToString(" • ")}"

            AlertDialog.Builder(this)
                .setTitle("Chặn an toàn tuyệt đối")
                .setMessage("Bài đăng còn chứa thông tin nội bộ:\n\n${details.joinToString("\n")}\n\nVui lòng xóa các thông tin này khỏi bài đăng trước khi chuyển sang trạng thái SẴN SÀNG.")
                .setPositiveButton("Đã hiểu", null)
                .show()
            return
        }

        binding.bannerSafetyViolation.visibility = View.GONE
        saveListing(ListingStatus.READY)
    }

    private fun saveListing(status: ListingStatus) {
        val current = currentListing ?: return
        val rendered = binding.etRenderedText.text.toString()
        val district = binding.etDistrict.text.toString().trim().ifBlank { null }
        val roomTypeStr = binding.etRoomType.text.toString().trim()
        val roomType = RoomType.values().firstOrNull { it.displayName.equals(roomTypeStr, true) }
            ?: current.roomType

        val updated = current.copy(
            renderedText = rendered,
            district = district,
            roomType = roomType,
            status = status
        )

        lifecycleScope.launch {
            repository.updateListing(updated)
            Toast.makeText(
                this@PostEditorActivity,
                if (status == ListingStatus.READY) "Đã lưu & SẴN SÀNG đăng bài!" else "Đã lưu bản nháp",
                Toast.LENGTH_SHORT
            ).show()
            finish()
        }
    }

    private fun handleSelectedPhotos(uris: List<Uri>) {
        val listing = currentListing ?: return
        lifecycleScope.launch {
            val processed = mutableListOf<String>()
            for (u in uris) {
                val path = PhotoProcessor.processImage(
                    this@PostEditorActivity,
                    u,
                    watermarkText = prefs.hotline
                )
                if (path != null) {
                    processed.add(path)
                }
            }
            if (processed.isNotEmpty()) {
                repository.addPhotos(listing.id, processed)
                Toast.makeText(this@PostEditorActivity, "Đã thêm ${processed.size} ảnh (Đã xóa GPS)", Toast.LENGTH_SHORT).show()
            }
        }
    }

    companion object {
        const val EXTRA_LISTING_ID = "extra_listing_id"
    }
}
