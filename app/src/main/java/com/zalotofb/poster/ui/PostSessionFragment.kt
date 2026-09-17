package com.zalotofb.poster.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.zalotofb.poster.data.local.AppDatabase
import com.zalotofb.poster.data.local.PreferenceStorage
import com.zalotofb.poster.data.local.entity.FbGroupEntity
import com.zalotofb.poster.data.local.entity.ListingEntity
import com.zalotofb.poster.data.local.entity.PostLogEntity
import com.zalotofb.poster.data.repository.ListingRepository
import com.zalotofb.poster.databinding.FragmentPostSessionBinding
import com.zalotofb.poster.domain.model.ListingStatus
import com.zalotofb.poster.domain.parser.ListingParser
import com.zalotofb.poster.domain.template.TemplateEngine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.UUID

class PostSessionFragment : Fragment() {

    private var _binding: FragmentPostSessionBinding? = null
    private val binding get() = _binding!!

    private lateinit var db: AppDatabase
    private lateinit var prefs: PreferenceStorage
    private lateinit var repository: ListingRepository

    private var targetListingId: String? = null
    private var currentListing: ListingEntity? = null
    private var sessionSteps = mutableListOf<PostSessionStep>()
    private var currentStepIndex = 0

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View {
        _binding = FragmentPostSessionBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        val context = requireContext()
        db = AppDatabase.getInstance(context)
        prefs = PreferenceStorage(context)
        repository = ListingRepository(db, prefs)

        targetListingId = arguments?.getString(ARG_LISTING_ID)

        lifecycleScope.launch {
            initSession()
        }

        binding.btnLaunchFb.setOnClickListener {
            val step = sessionSteps.getOrNull(currentStepIndex) ?: return@setOnClickListener
            ShareAssistManager.launchShareAssist(
                requireContext(),
                step.renderedText,
                step.photoUris,
                step.group.url
            )
        }

        binding.btnVerifiedPosted.setOnClickListener {
            recordPostLogAndNext(wasPosted = true)
        }

        binding.btnPendingAdmin.setOnClickListener {
            recordPostLogAndNext(wasPosted = true)
        }

        binding.btnSkipGroup.setOnClickListener {
            nextStep()
        }
    }

    private suspend fun initSession() {
        val listing = if (targetListingId != null) {
            repository.getById(targetListingId!!)
        } else {
            repository.observeByStatus(ListingStatus.READY).first().firstOrNull()
                ?: repository.observeAll().first().firstOrNull()
        }

        if (listing == null) {
            binding.tvGroupTargetName.text = "Chưa có tin phòng nào để đăng"
            binding.tvPostPreview.text = "Vui lòng vào tab Kho phòng, chọn một tin ở trạng thái 'SẴN SÀNG' rồi bấm 'Đăng bài'."
            binding.btnLaunchFb.isEnabled = false
            return
        }

        currentListing = listing
        val activeGroups = db.fbGroupDao().observeActive().first()

        if (activeGroups.isEmpty()) {
            binding.tvGroupTargetName.text = "Chưa có nhóm Facebook nào"
            binding.tvPostPreview.text = "Vui lòng vào tab Nhóm FB để thêm các nhóm Facebook đăng bài."
            binding.btnLaunchFb.isEnabled = false
            return
        }

        // Check if > 15 groups selected -> show caution warning
        if (activeGroups.size > 15) {
            AlertDialog.Builder(requireContext())
                .setTitle("Lưu ý an toàn tài khoản")
                .setMessage("Bạn đang chọn ${activeGroups.size} nhóm trong một phiên. Nhiều nhóm giới hạn 1 bài/ngày. Chia thành nhiều ngày sẽ ra khách đều hơn và giữ an toàn cho tài khoản Facebook.")
                .setPositiveButton("Tiếp tục", null)
                .setNegativeButton("Chỉ đăng 10 nhóm") { _, _ ->
                    setupSteps(listing, activeGroups.take(10))
                }
                .show()
        }

        setupSteps(listing, activeGroups)
    }

    private fun setupSteps(listing: ListingEntity, groups: List<FbGroupEntity>) {
        sessionSteps.clear()
        currentStepIndex = 0

        val parsed = ListingParser.parse(listing.rawText)
        val template = prefs.customTemplate ?: TemplateEngine.DEFAULT_TEMPLATE

        groups.forEachIndexed { index, group ->
            val variant = index % 5
            val rendered = TemplateEngine.render(
                template = template,
                listing = parsed,
                cleanText = listing.cleanText,
                hotline = prefs.hotline,
                signature = prefs.signature,
                trackingCode = group.trackingCode,
                variantIndex = variant
            )

            sessionSteps.add(
                PostSessionStep(
                    group = group,
                    variantIndex = variant,
                    trackingCode = group.trackingCode,
                    renderedText = rendered,
                    photoUris = emptyList()
                )
            )
        }

        showCurrentStep()
    }

    private fun showCurrentStep() {
        val step = sessionSteps.getOrNull(currentStepIndex) ?: return
        binding.tvStepIndicator.text = "Nhóm ${currentStepIndex + 1}/${sessionSteps.size}"
        binding.tvTrackingBadge.text = "#${step.trackingCode}"
        binding.tvGroupTargetName.text = step.group.name
        binding.tvVariantTag.text = "Biến thể ${step.variantIndex + 1} • Nhóm ${step.group.districtTag ?: "Chung"}"
        binding.tvPostPreview.text = step.renderedText
        binding.btnLaunchFb.isEnabled = true
    }

    private fun recordPostLogAndNext(wasPosted: Boolean) {
        val step = sessionSteps.getOrNull(currentStepIndex) ?: return
        val listing = currentListing ?: return

        lifecycleScope.launch {
            if (wasPosted) {
                val log = PostLogEntity(
                    id = UUID.randomUUID().toString(),
                    listingId = listing.id,
                    groupId = step.group.id,
                    postedAt = System.currentTimeMillis(),
                    fbPostUrl = null,
                    variantIndex = step.variantIndex
                )
                db.postLogDao().insert(log)
                repository.updateListing(listing.copy(status = ListingStatus.LISTED))
            }
            nextStep()
        }
    }

    private fun nextStep() {
        currentStepIndex++
        if (currentStepIndex >= sessionSteps.size) {
            Toast.makeText(requireContext(), "Đã hoàn thành toàn bộ phiên đăng bài!", Toast.LENGTH_LONG).show()
            binding.tvGroupTargetName.text = "Phiên đăng bài đã kết thúc"
            binding.tvPostPreview.text = "Tất cả các nhóm trong phiên đã được xử lý thành công."
            binding.btnLaunchFb.isEnabled = false
        } else {
            showCurrentStep()
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    companion object {
        const val ARG_LISTING_ID = "target_listing_id"

        fun newInstance(listingId: String?): PostSessionFragment {
            return PostSessionFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_LISTING_ID, listingId)
                }
            }
        }
    }
}
