package com.zalotofb.poster.ui

import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.button.MaterialButton
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.textfield.TextInputEditText
import com.zalotofb.poster.R
import com.zalotofb.poster.data.models.FacebookGroup
import com.zalotofb.poster.data.models.PostItem
import com.zalotofb.poster.data.models.PostStatus
import com.zalotofb.poster.data.repository.StorageRepository
import com.zalotofb.poster.facebook.FacebookSessionManager
import com.zalotofb.poster.services.FacebookPostWorker
import com.zalotofb.poster.services.ZaloNotificationListener
import com.zalotofb.poster.ui.adapters.GroupAdapter
import com.zalotofb.poster.ui.adapters.PostAdapter
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private lateinit var repository: StorageRepository
    private lateinit var sessionManager: FacebookSessionManager

    private lateinit var bottomNav: BottomNavigationView
    private var currentTabId = R.id.nav_queue

    // Adapters
    private lateinit var postAdapter: PostAdapter
    private lateinit var groupAdapter: GroupAdapter

    // Views container
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

        // Lắng nghe cập nhật danh sách bài viết từ background
        repository.addPostChangeListener {
            runOnUiThread {
                if (currentTabId == R.id.nav_queue) {
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

    // --- TAB 1: HÀNG ĐỢI BÀI VIẾT ---
    private fun showQueueTab() {
        fragmentContainer.removeAllViews()
        val view = layoutInflater.inflate(R.layout.fragment_queue, fragmentContainer, true)

        val switchAuto: MaterialSwitch = view.findViewById(R.id.switch_auto_mode)
        val tvDesc: TextView = view.findViewById(R.id.tv_mode_desc)
        val rvPosts: RecyclerView = view.findViewById(R.id.rv_posts)
        val layoutEmpty: View = view.findViewById(R.id.layout_empty)
        val fabAdd: FloatingActionButton = view.findViewById(R.id.fab_add_post)

        val settings = repository.getSettings()
        switchAuto.isChecked = settings.isAutoMode
        tvDesc.text = if (settings.isAutoMode) "Đang bật: Tự động 100% (Cứ có tin Zalo là tự đăng)" else "Đang tắt: Bán tự động (cần bấm duyệt trước khi đăng)"

        switchAuto.setOnCheckedChangeListener { _, isChecked ->
            settings.isAutoMode = isChecked
            repository.saveSettings(settings)
            tvDesc.text = if (isChecked) "Đang bật: Tự động 100% (Cứ có tin Zalo là tự đăng)" else "Đang tắt: Bán tự động (cần bấm duyệt trước khi đăng)"
            Toast.makeText(this, "Đã chuyển sang: ${if (isChecked) "Tự động 100%" else "Bán tự động"}", Toast.LENGTH_SHORT).show()
        }

        rvPosts.layoutManager = LinearLayoutManager(this)
        val posts = repository.getPosts()
        layoutEmpty.visibility = if (posts.isEmpty()) View.VISIBLE else View.GONE

        postAdapter = PostAdapter(
            posts = posts,
            onPostNowClick = { post ->
                approveAndPost(post)
            },
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

        Toast.makeText(this, "Đã đưa bài viết vào hàng đợi đăng!", Toast.LENGTH_SHORT).show()
    }

    // --- TAB 2: NHÓM FACEBOOK ---
    private fun showGroupsTab() {
        fragmentContainer.removeAllViews()
        val view = layoutInflater.inflate(R.layout.fragment_groups, fragmentContainer, true)

        val tvStatus: TextView = view.findViewById(R.id.tv_fb_status)
        val btnLogin: MaterialButton = view.findViewById(R.id.btn_login_facebook)
        val btnAddManual: MaterialButton = view.findViewById(R.id.btn_add_group_manual)
        val rvGroups: RecyclerView = view.findViewById(R.id.rv_groups)

        updateFbStatusText(tvStatus, btnLogin)

        btnLogin.setOnClickListener {
            val intent = Intent(this, FacebookLoginActivity::class.java)
            startActivity(intent)
        }

        btnAddManual.setOnClickListener {
            showAddGroupDialog()
        }

        rvGroups.layoutManager = LinearLayoutManager(this)
        groupAdapter = GroupAdapter(
            groups = repository.getFacebookGroups(),
            onToggleSelect = { group, isSelected ->
                repository.saveFacebookGroup(group)
            },
            onDeleteGroup = { group ->
                repository.deleteFacebookGroup(group.id)
                groupAdapter.updateData(repository.getFacebookGroups())
            }
        )
        rvGroups.adapter = groupAdapter
    }

    private fun updateFbStatusText(tvStatus: TextView, btnLogin: MaterialButton) {
        if (sessionManager.isLoggedIn()) {
            tvStatus.text = "✅ Đã đăng nhập: ${sessionManager.getUserName()} (ID: ${sessionManager.getUserId()})"
            btnLogin.text = "Đăng nhập lại / Đổi tài khoản"
        } else {
            tvStatus.text = "⚠️ Chưa đăng nhập. Vui lòng đăng nhập để app tự động đăng bài"
            btnLogin.text = "Đăng nhập Facebook (Lấy Cookie)"
        }
    }

    private fun showAddGroupDialog() {
        val dialogView = LayoutInflater.from(this).inflate(R.layout.item_group, null)
        val etName = EditText(this).apply { hint = "Tên Nhóm (VD: Chợ Sỉ Quần Áo)" }
        val etId = EditText(this).apply { hint = "ID Nhóm Facebook (VD: 1234567890)" }

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(40, 20, 40, 10)
            addView(etName)
            addView(etId)
        }

        AlertDialog.Builder(this)
            .setTitle("Thêm Nhóm Facebook Đích")
            .setView(layout)
            .setPositiveButton("Thêm") { _, _ ->
                val name = etName.text.toString().trim()
                val id = etId.text.toString().trim()
                if (name.isNotEmpty() && id.isNotEmpty()) {
                    val newGroup = FacebookGroup(id = id, name = name, isSelected = true)
                    repository.saveFacebookGroup(newGroup)
                    groupAdapter.updateData(repository.getFacebookGroups())
                    Toast.makeText(this, "Đã thêm nhóm: $name", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Hủy", null)
            .show()
    }

    // --- TAB 3: CÀI ĐẶT ---
    private fun showSettingsTab() {
        fragmentContainer.removeAllViews()
        val view = layoutInflater.inflate(R.layout.fragment_settings, fragmentContainer, true)

        val btnNotif: MaterialButton = view.findViewById(R.id.btn_grant_notif)
        val btnOverlay: MaterialButton = view.findViewById(R.id.btn_grant_overlay)
        val etZaloGroups: TextInputEditText = view.findViewById(R.id.et_zalo_groups)
        val etPhone: TextInputEditText = view.findViewById(R.id.et_replace_phone)
        val etSignature: TextInputEditText = view.findViewById(R.id.et_signature)
        val etDelay: TextInputEditText = view.findViewById(R.id.et_delay_sec)
        val btnSave: MaterialButton = view.findViewById(R.id.btn_save_settings)

        val settings = repository.getSettings()
        etZaloGroups.setText(settings.monitoredZaloGroups)
        etPhone.setText(settings.replacementPhone)
        etSignature.setText(settings.signatureText)
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
            settings.monitoredZaloGroups = etZaloGroups.text.toString().trim()
            settings.replacementPhone = etPhone.text.toString().trim()
            settings.signatureText = etSignature.text.toString().trim()
            settings.antiBanDelaySeconds = etDelay.text.toString().toIntOrNull() ?: 180

            repository.saveSettings(settings)
            Toast.makeText(this, "Đã lưu cài đặt thành công!", Toast.LENGTH_SHORT).show()
        }
    }

    private fun checkPermissionsOnStartup() {
        // Kiểm tra quyền Notification Listener
        val cn = ComponentName(this, ZaloNotificationListener::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        val isNotifEnabled = flat != null && flat.contains(cn.flattenToString())

        if (!isNotifEnabled) {
            AlertDialog.Builder(this)
                .setTitle("Cấp quyền đọc thông báo Zalo")
                .setMessage("Để app tự động phát hiện bài đăng mới trong nhóm Zalo, vui lòng bật quyền 'Truy cập thông báo' cho ứng dụng Z2FB Manager.")
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
}
