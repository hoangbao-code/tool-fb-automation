package com.zalotofb.poster.ui

import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.ChipGroup
import com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.textfield.TextInputEditText
import com.zalotofb.poster.R
import com.zalotofb.poster.data.models.FacebookGroup
import com.zalotofb.poster.data.models.PostItem
import com.zalotofb.poster.data.models.PostStatus
import com.zalotofb.poster.data.repository.StorageRepository
import com.zalotofb.poster.facebook.FacebookGroupScanner
import com.zalotofb.poster.facebook.FacebookSessionManager
import com.zalotofb.poster.services.FacebookPostWorker
import com.zalotofb.poster.services.ZaloNotificationListener
import com.zalotofb.poster.ui.adapters.GroupAdapter
import com.zalotofb.poster.ui.adapters.PostAdapter
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var repository: StorageRepository
    private lateinit var sessionManager: FacebookSessionManager

    private lateinit var bottomNav: BottomNavigationView
    private var currentTabId = R.id.nav_queue

    private lateinit var postAdapter: PostAdapter
    private lateinit var groupAdapter: GroupAdapter

    private lateinit var fragmentContainer: android.widget.FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        repository = StorageRepository.getInstance(this)
        sessionManager = FacebookSessionManager.getInstance(this)

        bottomNav = findViewById(R.id.bottom_navigation)
        fragmentContainer = findViewById(R.id.fragment_container)

        setupBottomNavigation()
        showQueueTab()

        repository.addPostChangeListener {
            runOnUiThread {
                if (currentTabId == R.id.nav_queue && ::postAdapter.isInitialized) {
                    postAdapter.updateData(repository.getPosts())
                }
            }
        }

        checkPermissionsOnStartup()
    }

    private fun setupBottomNavigation() {
        bottomNav.setOnItemSelectedListener { item ->
            currentTabId = item.itemId
            when (item.itemId) {
                R.id.nav_queue -> {
                    showQueueTab()
                    true
                }
                R.id.nav_groups -> {
                    showGroupsTab()
                    true
                }
                R.id.nav_settings -> {
                    showSettingsTab()
                    true
                }
                else -> false
            }
        }
    }

    // --- TAB 1: GIỎ HÀNG PHÒNG CHDV ---
    private fun showQueueTab() {
        fragmentContainer.removeAllViews()
        val view = layoutInflater.inflate(R.layout.fragment_queue, fragmentContainer, true)

        val switchAuto: MaterialSwitch = view.findViewById(R.id.switch_auto_mode)
        val tvDesc: TextView = view.findViewById(R.id.tv_mode_desc)
        val chipGroup: ChipGroup = view.findViewById(R.id.chip_group_status)
        val rvPosts: RecyclerView = view.findViewById(R.id.rv_posts)
        val layoutEmpty: View = view.findViewById(R.id.layout_empty)
        val fabAdd: ExtendedFloatingActionButton = view.findViewById(R.id.fab_add_post)

        val settings = repository.getSettings()
        switchAuto.isChecked = settings.isAutoMode
        tvDesc.text = if (settings.isAutoMode) {
            "Đang bật: Tự động 100% (Zalo có phòng ➔ AI tự ráp form ➔ Tự đăng FB)"
        } else {
            "Đang tắt: Bán tự động (AI viết bài sẵn ➔ Bạn bấm duyệt mới đăng)"
        }

        switchAuto.setOnCheckedChangeListener { _, isChecked ->
            settings.isAutoMode = isChecked
            repository.saveSettings(settings)
            tvDesc.text = if (isChecked) {
                "Đang bật: Tự động 100% (Zalo có phòng ➔ AI tự ráp form ➔ Tự đăng FB)"
            } else {
                "Đang tắt: Bán tự động (AI viết bài sẵn ➔ Bạn bấm duyệt mới đăng)"
            }
            Toast.makeText(this, "Đã chuyển sang: ${if (isChecked) "Tự động 100%" else "Bán tự động"}", Toast.LENGTH_SHORT).show()
        }

        rvPosts.layoutManager = LinearLayoutManager(this)
        val posts = repository.getPosts()
        layoutEmpty.visibility = if (posts.isEmpty()) View.VISIBLE else View.GONE

        postAdapter = PostAdapter(
            allPosts = posts,
            onPostNowClick = { post -> approveAndPost(post) },
            onEditClick = { post ->
                val intent = Intent(this, PostEditorActivity::class.java).apply {
                    putExtra(PostEditorActivity.EXTRA_POST_ID, post.id)
                }
                startActivity(intent)
            },
            onDeleteClick = { post ->
                repository.deletePost(post.id)
                postAdapter.updateData(repository.getPosts())
            }
        )
        rvPosts.adapter = postAdapter

        // Filter chips listener
        chipGroup.setOnCheckedStateChangeListener { _, checkedIds ->
            when (checkedIds.firstOrNull()) {
                R.id.chip_filter_pending -> postAdapter.filterByStatus(PostStatus.PENDING)
                R.id.chip_filter_posted -> postAdapter.filterByStatus(PostStatus.POSTED)
                R.id.chip_filter_failed -> postAdapter.filterByStatus(PostStatus.FAILED)
                else -> postAdapter.filterByStatus(null)
            }
        }

        fabAdd.setOnClickListener {
            val intent = Intent(this, PostEditorActivity::class.java)
            startActivity(intent)
        }
    }

    private fun approveAndPost(post: PostItem) {
        if (!sessionManager.isLoggedIn()) {
            Toast.makeText(this, "Vui lòng đăng nhập Facebook trước (Tab Nhóm Facebook)", Toast.LENGTH_LONG).show()
            bottomNav.selectedItemId = R.id.nav_groups
            return
        }

        repository.updatePostStatus(post.id, PostStatus.QUEUED)
        postAdapter.updateData(repository.getPosts())

        val workData = workDataOf(FacebookPostWorker.KEY_POST_ID to post.id)
        val request = OneTimeWorkRequestBuilder<FacebookPostWorker>()
            .setInputData(workData)
            .build()
        WorkManager.getInstance(this).enqueue(request)

        Toast.makeText(this, "Đã xếp hàng đăng bài lên các nhóm Facebook đã chọn!", Toast.LENGTH_SHORT).show()
    }

    // --- TAB 2: NHÓM FACEBOOK BĐS ---
    private fun showGroupsTab() {
        fragmentContainer.removeAllViews()
        val view = layoutInflater.inflate(R.layout.fragment_groups, fragmentContainer, true)

        val tvUserName: TextView = view.findViewById(R.id.tv_fb_user_name)
        val tvStatus: TextView = view.findViewById(R.id.tv_fb_status)
        val btnLogin: MaterialButton = view.findViewById(R.id.btn_login_facebook)
        val btnScanGroups: MaterialButton = view.findViewById(R.id.btn_scan_groups)
        val etSearch: EditText = view.findViewById(R.id.et_search_groups)
        val btnAddManual: MaterialButton = view.findViewById(R.id.btn_add_group_manual)
        val tvSelectedCount: TextView = view.findViewById(R.id.tv_groups_selected_count)
        val btnSelectAll: TextView = view.findViewById(R.id.btn_select_all_groups)
        val btnDeselectAll: TextView = view.findViewById(R.id.btn_deselect_all_groups)
        val rvGroups: RecyclerView = view.findViewById(R.id.rv_groups)

        updateFbHeader(tvUserName, tvStatus, btnLogin)

        btnLogin.setOnClickListener {
            val intent = Intent(this, FacebookLoginActivity::class.java)
            startActivity(intent)
        }

        // Tự động quét nhóm từ Facebook bằng 1-Click
        btnScanGroups.setOnClickListener {
            if (!sessionManager.isLoggedIn()) {
                Toast.makeText(this, "Vui lòng đăng nhập Facebook trước khi quét nhóm!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            btnScanGroups.isEnabled = false
            btnScanGroups.text = "⏳ Đang quét danh sách nhóm FB..."

            lifecycleScope.launch {
                val result = FacebookGroupScanner.scanJoinedGroups(this@MainActivity)
                btnScanGroups.isEnabled = true
                btnScanGroups.text = "🔄 Tự Động Quét Sạch Nhóm Đã Tham Gia"

                result.onSuccess { scannedGroups ->
                    scannedGroups.forEach { repository.saveFacebookGroup(it) }
                    val all = repository.getFacebookGroups()
                    groupAdapter.updateData(all)
                    updateSelectedCount(tvSelectedCount)
                    Toast.makeText(this@MainActivity, "Đã quét thành công ${scannedGroups.size} nhóm Facebook!", Toast.LENGTH_LONG).show()
                }.onFailure { err ->
                    Toast.makeText(this@MainActivity, "Quét thất bại: ${err.message}", Toast.LENGTH_LONG).show()
                }
            }
        }

        btnAddManual.setOnClickListener {
            showAddGroupDialog(tvSelectedCount)
        }

        rvGroups.layoutManager = LinearLayoutManager(this)
        groupAdapter = GroupAdapter(
            allGroups = repository.getFacebookGroups(),
            onToggleSelect = { group, _ ->
                repository.saveFacebookGroup(group)
                updateSelectedCount(tvSelectedCount)
            },
            onDeleteGroup = { group ->
                repository.deleteFacebookGroup(group.id)
                groupAdapter.updateData(repository.getFacebookGroups())
                updateSelectedCount(tvSelectedCount)
            }
        )
        rvGroups.adapter = groupAdapter
        updateSelectedCount(tvSelectedCount)

        // Tìm kiếm nhóm
        etSearch.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                groupAdapter.filter(s?.toString() ?: "")
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        // Chọn tất cả
        btnSelectAll.setOnClickListener {
            groupAdapter.selectAll(true)
            repository.getFacebookGroups().forEach { it.isSelected = true; repository.saveFacebookGroup(it) }
            updateSelectedCount(tvSelectedCount)
        }

        // Bỏ chọn tất cả
        btnDeselectAll.setOnClickListener {
            groupAdapter.selectAll(false)
            repository.getFacebookGroups().forEach { it.isSelected = false; repository.saveFacebookGroup(it) }
            updateSelectedCount(tvSelectedCount)
        }
    }

    private fun updateFbHeader(tvName: TextView, tvStatus: TextView, btnLogin: MaterialButton) {
        if (sessionManager.isLoggedIn()) {
            tvName.text = sessionManager.getUserName()
            tvStatus.text = "🟢 Trạng thái: Live (UID: ${sessionManager.getUserId()})"
            btnLogin.text = "Đổi nick"
        } else {
            tvName.text = "Chưa kết nối Facebook"
            tvStatus.text = "⚠️ Vui lòng đăng nhập để hệ thống tự động đăng bài"
            btnLogin.text = "Đăng nhập"
        }
    }

    private fun updateSelectedCount(tvCount: TextView) {
        val groups = repository.getFacebookGroups()
        val selected = groups.count { it.isSelected }
        tvCount.text = "Đã chọn: $selected / ${groups.size} nhóm"
    }

    private fun showAddGroupDialog(tvSelectedCount: TextView) {
        val etName = EditText(this).apply { hint = "Tên Nhóm (VD: Hội Thuê Phòng Q3)" }
        val etDistrict = EditText(this).apply { hint = "Khu vực / Quận (VD: Quận 3, Bình Thạnh)" }
        val etId = EditText(this).apply { hint = "ID Nhóm Facebook (VD: 1029384756)" }

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(40, 20, 40, 10)
            addView(etName)
            addView(etDistrict)
            addView(etId)
        }

        AlertDialog.Builder(this)
            .setTitle("Thêm Nhóm Facebook Đích")
            .setView(layout)
            .setPositiveButton("Thêm") { _, _ ->
                val name = etName.text.toString().trim()
                val district = etDistrict.text.toString().trim().ifBlank { "Toàn TP" }
                val id = etId.text.toString().trim()
                if (name.isNotEmpty() && id.isNotEmpty()) {
                    val newGroup = FacebookGroup(id = id, name = name, districtTag = district, isSelected = true)
                    repository.saveFacebookGroup(newGroup)
                    groupAdapter.updateData(repository.getFacebookGroups())
                    updateSelectedCount(tvSelectedCount)
                    Toast.makeText(this, "Đã thêm nhóm: $name", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Hủy", null)
            .show()
    }

    // --- TAB 3: CÀI ĐẶT & AI FORM ---
    private fun showSettingsTab() {
        fragmentContainer.removeAllViews()
        val view = layoutInflater.inflate(R.layout.fragment_settings, fragmentContainer, true)

        val btnNotif: MaterialButton = view.findViewById(R.id.btn_grant_notif)
        val btnOverlay: MaterialButton = view.findViewById(R.id.btn_grant_overlay)
        val etAiTemplate: TextInputEditText = view.findViewById(R.id.et_ai_template)
        val etPhone: TextInputEditText = view.findViewById(R.id.et_replace_phone)
        val etSignature: TextInputEditText = view.findViewById(R.id.et_signature)
        val etZaloGroups: TextInputEditText = view.findViewById(R.id.et_zalo_groups)
        val etDelay: TextInputEditText = view.findViewById(R.id.et_delay_sec)
        val btnSave: MaterialButton = view.findViewById(R.id.btn_save_settings)

        val settings = repository.getSettings()
        etAiTemplate.setText(settings.aiPromptTemplate)
        etPhone.setText(settings.replacementPhone)
        etSignature.setText(settings.signatureText)
        etZaloGroups.setText(settings.monitoredZaloGroups)
        etDelay.setText(settings.antiBanDelaySeconds.toString())

        btnNotif.setOnClickListener {
            startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
        }

        btnOverlay.setOnClickListener {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
                startActivity(intent)
            }
        }

        btnSave.setOnClickListener {
            settings.aiPromptTemplate = etAiTemplate.text.toString().trim()
            settings.replacementPhone = etPhone.text.toString().trim()
            settings.signatureText = etSignature.text.toString().trim()
            settings.monitoredZaloGroups = etZaloGroups.text.toString().trim()
            settings.antiBanDelaySeconds = etDelay.text.toString().toIntOrNull() ?: 180

            repository.saveSettings(settings)
            Toast.makeText(this, "Đã lưu cài đặt và Form mẫu AI thành công!", Toast.LENGTH_SHORT).show()
        }
    }

    private fun checkPermissionsOnStartup() {
        val cn = ComponentName(this, ZaloNotificationListener::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        val isNotifEnabled = flat != null && flat.contains(cn.flattenToString())

        if (!isNotifEnabled) {
            AlertDialog.Builder(this)
                .setTitle("Cấp quyền đọc tin Zalo chủ nhà")
                .setMessage("Để app tự động nhận tin phòng mới từ các nhóm Zalo đầu chủ, vui lòng bật quyền 'Truy cập thông báo' cho ứng dụng CHDV Post Manager.")
                .setPositiveButton("Cấp quyền ngay") { _, _ ->
                    startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
                }
                .setNegativeButton("Để sau", null)
                .show()
        }
    }

    override fun onResume() {
        super.onResume()
        if (currentTabId == R.id.nav_queue && ::postAdapter.isInitialized) {
            postAdapter.updateData(repository.getPosts())
        }
    }
}\n