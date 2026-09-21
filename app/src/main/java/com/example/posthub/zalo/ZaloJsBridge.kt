package com.example.posthub.zalo

import android.webkit.JavascriptInterface
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.domain.model.PostSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray

data class DetectedZaloGroup(
    val name: String,
    val id: String = "",
    val avatarUrl: String = ""
)

class ZaloJsBridge(
    private val onMessageCaptured: (groupName: String, senderName: String, text: String) -> Unit,
    private val onGroupsScanned: (List<DetectedZaloGroup>) -> Unit
) {
    private val _activeConversation = MutableStateFlow("")
    val activeConversation = _activeConversation.asStateFlow()

    @JavascriptInterface
    fun onActiveConversationChanged(title: String, id: String) {
        val cleanTitle = title.trim()
        AppLog.d("ZaloJsBridge", "Zalo chuyển hội thoại đang mở: '$cleanTitle' (ID: $id)")
        _activeConversation.value = cleanTitle
    }

    @JavascriptInterface
    fun onNewMessage(groupName: String, senderName: String, text: String, timestamp: Long) {
        val cleanGroup = groupName.trim().ifBlank { _activeConversation.value.ifBlank { "Nhóm Zalo" } }
        val cleanText = text.trim()
        val cleanSender = senderName.trim().ifBlank { "Thành viên Zalo" }

        if (cleanText.isBlank()) return

        AppLog.i("ZaloJsBridge", "Nhận tin Zalo Web: [$cleanGroup] $cleanSender: ${cleanText.take(50)}...")
        onMessageCaptured(cleanGroup, cleanSender, cleanText)
    }

    @JavascriptInterface
    fun onDiscoveredGroups(jsonArrayString: String) {
        try {
            val list = mutableListOf<DetectedZaloGroup>()
            val array = JSONArray(jsonArrayString)
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                val name = item.optString("name").trim()
                val id = item.optString("id").trim()
                val avatar = item.optString("avatar").trim()
                if (name.isNotEmpty()) {
                    list.add(DetectedZaloGroup(name = name, id = id, avatarUrl = avatar))
                }
            }
            AppLog.i("ZaloJsBridge", "Đã quét được ${list.size} hội thoại/nhóm từ Zalo Web.")
            onGroupsScanned(list)
        } catch (e: Exception) {
            AppLog.e("ZaloJsBridge", "Lỗi bóc tách danh sách nhóm Zalo: ${e.message}", e)
        }
    }

    @JavascriptInterface
    fun log(tag: String, msg: String) {
        AppLog.d("ZaloWebJS", "[$tag] $msg")
    }
}
