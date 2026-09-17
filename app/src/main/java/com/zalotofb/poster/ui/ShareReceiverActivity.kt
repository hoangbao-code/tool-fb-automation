package com.zalotofb.poster.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.zalotofb.poster.data.local.AppDatabase
import com.zalotofb.poster.data.local.PreferenceStorage
import com.zalotofb.poster.data.local.entity.FbGroupEntity
import com.zalotofb.poster.data.photo.PhotoProcessor
import com.zalotofb.poster.data.repository.ListingRepository
import com.zalotofb.poster.domain.model.Source
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.UUID

class ShareReceiverActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        lifecycleScope.launch {
            handleIncomingShare(intent)
            finish()
        }
    }

    private suspend fun handleIncomingShare(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        val type = intent.type ?: ""

        val textContent = intent.getStringExtra(Intent.EXTRA_TEXT) ?: ""
        val inputUris = mutableListOf<Uri>()

        if (Intent.ACTION_SEND == action) {
            if (type.startsWith("image/")) {
                val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                uri?.let { inputUris.add(it) }
            }
        } else if (Intent.ACTION_SEND_MULTIPLE == action) {
            if (type.startsWith("image/")) {
                val uris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                }
                uris?.let { inputUris.addAll(it) }
            }
        }

        if (textContent.isBlank() && inputUris.isEmpty()) {
            Toast.makeText(this, "Không có nội dung chia sẻ để xử lý!", Toast.LENGTH_SHORT).show()
            return
        }

        val db = AppDatabase.getInstance(this)
        val prefs = PreferenceStorage(this)
        val repository = ListingRepository(db, prefs)

        // Special Case: Facebook Group Shared Link (Spec 4.b)
        if (textContent.contains("facebook.com/groups/") || textContent.contains("fb.com/groups/")) {
            val slug = ShareAssistManager.extractGroupIdOrSlug(textContent)
            val allGroups = db.fbGroupDao().observeAll().first()
            val existing = db.fbGroupDao().findByUrl(textContent.trim())
            if (existing != null) {
                Toast.makeText(this, "Nhóm Facebook '$slug' đã có trong danh sách!", Toast.LENGTH_SHORT).show()
                return
            }

            val existingCodes = allGroups.map { it.trackingCode }.toSet()
            val district = ShareAssistManager.suggestDistrictTag(slug)
            val trackingCode = ShareAssistManager.generateTrackingCode(district, existingCodes)

            val newGroup = FbGroupEntity(
                id = UUID.randomUUID().toString(),
                name = "Nhóm $slug",
                url = textContent.trim(),
                districtTag = district,
                trackingCode = trackingCode,
                postLimitPerDay = 1,
                isActive = true
            )
            db.fbGroupDao().insert(newGroup)
            Toast.makeText(this, "Đã thêm nhóm Facebook: $slug (#$trackingCode)", Toast.LENGTH_LONG).show()
            return
        }

        val rawText = textContent.ifBlank { "Tin chia sẻ từ Zalo kèm ${inputUris.size} ảnh" }
        val listing = repository.ingestRawListing(
            rawText = rawText,
            source = Source.SHARE_INTENT,
            sourceGroup = "Chia sẻ từ Zalo"
        )

        // Process and strip EXIF for all shared images
        val processedPhotos = mutableListOf<String>()
        for (u in inputUris) {
            val processed = PhotoProcessor.processImage(this, u, watermarkText = prefs.hotline)
            if (processed != null) {
                processedPhotos.add(processed)
            }
        }
        if (processedPhotos.isNotEmpty()) {
            repository.addPhotos(listing.id, processedPhotos)
        }

        Toast.makeText(this, "Đã nạp tin phòng thành công!", Toast.LENGTH_SHORT).show()

        // Open editor directly
        val editorIntent = Intent(this, PostEditorActivity::class.java).apply {
            putExtra(PostEditorActivity.EXTRA_LISTING_ID, listing.id)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(editorIntent)
    }
}
