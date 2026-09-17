package com.zalotofb.poster.data.repository

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.zalotofb.poster.data.models.AppSettings
import com.zalotofb.poster.data.models.FacebookGroup
import com.zalotofb.poster.data.models.PostItem
import com.zalotofb.poster.data.models.PostStatus
import java.util.concurrent.CopyOnWriteArrayList

class StorageRepository private constructor(context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    private val gson = Gson()

    private val postChangeListeners = CopyOnWriteArrayList<() -> Unit>()

    companion object {
        private const val PREF_NAME = "z2fb_storage_prefs"
        private const val KEY_POSTS = "key_posts_list"
        private const val KEY_GROUPS = "key_groups_list"
        private const val KEY_SETTINGS = "key_app_settings"

        @Volatile
        private var instance: StorageRepository? = null

        fun getInstance(context: Context): StorageRepository {
            return instance ?: synchronized(this) {
                instance ?: StorageRepository(context.applicationContext).also { instance = it }
            }
        }
    }

    // --- Listeners ---
    fun addPostChangeListener(listener: () -> Unit) {
        postChangeListeners.add(listener)
    }

    fun removePostChangeListener(listener: () -> Unit) {
        postChangeListeners.remove(listener)
    }

    private fun notifyPostChanged() {
        postChangeListeners.forEach { it.invoke() }
    }

    // --- Posts Management ---
    @Synchronized
    fun getPosts(): MutableList<PostItem> {
        val json = prefs.getString(KEY_POSTS, null) ?: return defaultSamplePosts()
        val type = object : TypeToken<MutableList<PostItem>>() {}.type
        return try {
            val list: MutableList<PostItem>? = gson.fromJson(json, type)
            if (list == null) defaultSamplePosts() else list
        } catch (e: Exception) {
            defaultSamplePosts()
        }
    }

    @Synchronized
    fun savePost(post: PostItem) {
        val posts = getPosts()
        val existingIndex = posts.indexOfFirst { it.id == post.id }
        if (existingIndex >= 0) {
            posts[existingIndex] = post
        } else {
            posts.add(0, post) // Thêm mới lên đầu
        }
        savePostsList(posts)
        notifyPostChanged()
    }

    @Synchronized
    fun deletePost(postId: String) {
        val posts = getPosts()
        if (posts.removeAll { it.id == postId }) {
            savePostsList(posts)
            notifyPostChanged()
        }
    }

    @Synchronized
    fun updatePostStatus(postId: String, newStatus: PostStatus, errorMsg: String? = null, postUrl: String? = null) {
        val posts = getPosts()
        val post = posts.find { it.id == postId } ?: return
        post.status = newStatus
        if (errorMsg != null) post.errorLog = errorMsg
        if (postUrl != null) post.fbPostUrl = postUrl
        savePostsList(posts)
        notifyPostChanged()
    }

    @Synchronized
    private fun savePostsList(posts: List<PostItem>) {
        val json = gson.toJson(posts)
        prefs.edit().putString(KEY_POSTS, json).apply()
    }

    // --- Facebook Groups Management ---
    @Synchronized
    fun getFacebookGroups(): MutableList<FacebookGroup> {
        val json = prefs.getString(KEY_GROUPS, null) ?: return defaultGroups()
        val type = object : TypeToken<MutableList<FacebookGroup>>() {}.type
        return try {
            val list: MutableList<FacebookGroup>? = gson.fromJson(json, type)
            if (list.isNullOrEmpty()) defaultGroups() else list
        } catch (e: Exception) {
            defaultGroups()
        }
    }

    @Synchronized
    fun saveFacebookGroup(group: FacebookGroup) {
        val list = getFacebookGroups()
        val idx = list.indexOfFirst { it.id == group.id }
        if (idx >= 0) {
            list[idx] = group
        } else {
            list.add(group)
        }
        saveGroupsList(list)
    }

    @Synchronized
    fun deleteFacebookGroup(groupId: String) {
        val list = getFacebookGroups()
        if (list.removeAll { it.id == groupId }) {
            saveGroupsList(list)
        }
    }

    @Synchronized
    fun saveGroupsList(groups: List<FacebookGroup>) {
        val json = gson.toJson(groups)
        prefs.edit().putString(KEY_GROUPS, json).apply()
    }

    private fun defaultGroups(): MutableList<FacebookGroup> {
        return mutableListOf(
            FacebookGroup(id = "group_chdv_1", name = "Hội Thuê Phòng Trọ & CHDV Bình Thạnh - Phú Nhuận", districtTag = "Bình Thạnh / Phú Nhuận", isSelected = true),
            FacebookGroup(id = "group_chdv_2", name = "Tìm Thuê Căn Hộ Dịch Vụ Q1, Q3, Q10 - Giá Tốt", districtTag = "Quận 1 / Q3 / Q10", isSelected = true),
            FacebookGroup(id = "group_chdv_3", name = "Cộng Đồng Căn Hộ Mini, Studio, Duplex TP.HCM", districtTag = "Toàn TP.HCM", isSelected = true),
            FacebookGroup(id = "group_chdv_4", name = "Cho Thuê CHDV Sinh Viên ĐH HUTECH - UEF - FTU", districtTag = "Khu Vực Đại Học", isSelected = true),
            FacebookGroup(id = "group_chdv_5", name = "Review Phòng Trọ & Căn Hộ Dịch Vụ Sài Gòn", districtTag = "Sài Gòn BĐS", isSelected = true)
        )
    }

    private fun defaultSamplePosts(): MutableList<PostItem> {
        return mutableListOf(
            PostItem(
                id = "sample_chdv_1",
                zaloGroupName = "Nhóm Đầu Chủ Q3 - Phú Nhuận",
                senderName = "Chủ Nhà Hoàng Nam",
                originalContent = "Trống phòng Studio ban công thoáng mát đường Huỳnh Tịnh Của, Q3. Full NT, máy giặt riêng, thang máy, bảo vệ 24/7. Giá 6.8tr. HH 50% môi giới chốt nhanh. LH 0909123456.",
                processedContent = """🔥 SIÊU PHẨM Studio Ban Công CỰC ĐẸP TẠI Quận 3 🔥

📍 Vị trí: Khu vực Quận 3 (Gần Huỳnh Tịnh Của, thuận tiện đi Q1, Bình Thạnh)
💰 Giá thuê: 6.8 Triệu / tháng

✨ TIỆN NGHI CĂN HỘ (Full nội thất cao cấp):
- Máy lạnh, tủ lạnh, máy giặt riêng, giường nệm cao cấp.
- Ban công thoáng mát, bếp nấu ăn riêng biệt.

🏢 TIỆN ÍCH TÒA NHÀ:
- Khóa cổng vân tay, camera an ninh 24/7.
- Thang máy, giờ giấc tự do 100%, không chung chủ.

📝 Chi tiết thêm từ chủ nhà:
• Trống phòng Studio ban công thoáng mát đường Huỳnh Tịnh Của, Q3
• Full NT, máy giặt riêng, thang máy, bảo vệ 24/7

☎️ Hotline / Zalo: 0988.888.888 (Tư vấn & dẫn xem phòng miễn phí 24/7!)
#chothuecanho #canhodichvu #chdv #quan3 #studio""".trimIndent(),
                roomType = "Studio Ban Công",
                district = "Quận 3",
                price = "6.8 Triệu / tháng",
                status = PostStatus.PENDING,
                createdAt = System.currentTimeMillis() - 1000 * 60 * 15
            ),
            PostItem(
                id = "sample_chdv_2",
                zaloGroupName = "Kho Hàng CHDV Bình Thạnh",
                senderName = "A. Hùng Quản Lý",
                originalContent = "Có căn Duplex gác cao không đụng đầu Nguyễn Gia Trí D2, Bình Thạnh. Cực gần ĐH Hutech, Ngoại Thương. Giá 7.5tr, hh 1 tháng cho ae sales. Cửa sổ lớn, cho nuôi pet.",
                processedContent = """🔥 SIÊU PHẨM Duplex Gác Lửng CỰC ĐẸP TẠI Bình Thạnh 🔥

📍 Vị trí: Khu vực Bình Thạnh (Gần HUTECH, ĐH Ngoại Thương, Landmark 81)
💰 Giá thuê: 7.5 Triệu / tháng

✨ TIỆN NGHI CĂN HỘ (Full nội thất cao cấp):
- Duplex gác cao đứng thoải mái, máy lạnh, tủ lạnh, giường tủ đầy đủ.
- Cửa sổ lớn đón gió tự nhiên, cho nuôi pet 🐶🐱.

🏢 TIỆN ÍCH TÒA NHÀ:
- Giờ giấc tự do 100%, ra vào khóa vân tay.
- Hầm để xe rộng rãi, bảo vệ an ninh.

📝 Chi tiết thêm từ chủ nhà:
• Có căn Duplex gác cao không đụng đầu Nguyễn Gia Trí D2, Bình Thạnh
• Cực gần ĐH Hutech, Ngoại Thương. Cửa sổ lớn, cho nuôi pet

☎️ Hotline / Zalo: 0988.888.888 (Tư vấn & dẫn xem phòng miễn phí 24/7!)
#chothuecanho #canhodichvu #chdv #binhthanh #duplex""".trimIndent(),
                roomType = "Duplex Gác Lửng",
                district = "Bình Thạnh",
                price = "7.5 Triệu / tháng",
                status = PostStatus.PENDING,
                createdAt = System.currentTimeMillis() - 1000 * 60 * 45
            )
        )
    }

    // --- App Settings ---
    @Synchronized
    fun getSettings(): AppSettings {
        val json = prefs.getString(KEY_SETTINGS, null) ?: return AppSettings()
        return try {
            gson.fromJson(json, AppSettings::class.java) ?: AppSettings()
        } catch (e: Exception) {
            AppSettings()
        }
    }

    @Synchronized
    fun saveSettings(settings: AppSettings) {
        val json = gson.toJson(settings)
        prefs.edit().putString(KEY_SETTINGS, json).apply()
    }
}
