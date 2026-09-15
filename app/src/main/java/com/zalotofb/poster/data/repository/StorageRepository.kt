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
        val json = prefs.getString(KEY_POSTS, null) ?: return mutableListOf()
        val type = object : TypeToken<MutableList<PostItem>>() {}.type
        return try {
            gson.fromJson(json, type) ?: mutableListOf()
        } catch (e: Exception) {
            mutableListOf()
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
            FacebookGroup(id = "group_demo_1", name = "Chợ Sỉ & Lẻ Toàn Quốc", isSelected = true),
            FacebookGroup(id = "group_demo_2", name = "Hội Kinh Doanh Online VN", isSelected = true)
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
