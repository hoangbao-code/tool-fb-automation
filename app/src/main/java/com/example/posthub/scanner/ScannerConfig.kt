package com.example.posthub.scanner

import android.content.Context
import com.example.posthub.data.AppLog
import org.json.JSONObject

data class FbSelectorConfig(
    val primaryUrl: String = "https://m.facebook.com/groups/?category=membership",
    val fallbackUrl: String = "https://www.facebook.com/groups/joins/",
    val checkpointIndicatorSelectors: List<String> = listOf("#checkpointSubmitButton", "[id*='checkpoint']"),
    val loginIndicatorSelectors: List<String> = listOf("input[name='email']", "input[name='pass']", "#m_login_button"),
    val groupItemLinkSelector: String = "a[href*='/groups/']",
    val groupCardContainer: String = "div[role='feed'] > div",
    val nameSelector: String = "span, strong, h3",
    val memberCountSelector: String = "div, span",
    val excludedPathIds: List<String> = listOf("feed", "discover", "notifications", "joins", "create", "search", "chats", "member")
)

data class ZaloSelectorConfig(
    val url: String = "https://chat.zalo.me",
    val qrLoginSelector: String = "#qr-container, .qrcode-img, [class*='qrcode']",
    val loggedInSelector: String = "#conversationList, div[data-id='virtual-list']",
    val virtualListSelector: String = "#conversationList, .conv-list, .virtualized-scroll, div[data-id='virtual-list']",
    val chatItemSelector: String = ".conv-item, [data-id*='conv_item']",
    val titleSelector: String = ".conv-item-title__more, .conv-item-title, [data-id='chat-title']",
    val lastMsgTimeSelector: String = ".conv-item-time, [class*='time']",
    val groupAvatarSelector: String = ".avatar-group, .avatar--group, [class*='group-avatar']",
    val contactsTabSelector: String = "[data-id='btn_Main_Tab_Contact'], div[icon='outline-contact']",
    val groupSubTabSelector: String = "[data-id='sub_tab_group'], div[title*='nhóm'], div[title*='Nhóm']",
    val groupListItemSelector: String = ".group-item, [data-id*='group_item'], .contact-list-item"
)

data class SafetyConfig(
    val minDelayMs: Long = 1500L,
    val maxDelayMs: Long = 3500L,
    val enrichMinDelayMs: Long = 5000L,
    val enrichMaxDelayMs: Long = 10000L,
    val maxFbGroups: Int = 300,
    val maxConsecutiveStallCount: Int = 3
)

data class FullScannerConfig(
    val facebook: FbSelectorConfig = FbSelectorConfig(),
    val zalo: ZaloSelectorConfig = ZaloSelectorConfig(),
    val safety: SafetyConfig = SafetyConfig()
) {
    companion object {
        fun loadFromAssets(context: Context): FullScannerConfig {
            return try {
                val jsonString = context.assets.open("selectors.json").bufferedReader().use { it.readText() }
                parse(jsonString)
            } catch (e: Exception) {
                AppLog.w("ScannerConfig", "Không thể nạp selectors.json từ assets: ${e.message}. Sử dụng cấu hình mặc định.")
                FullScannerConfig()
            }
        }

        fun parse(jsonString: String): FullScannerConfig {
            val root = JSONObject(jsonString)

            val fbObj = root.optJSONObject("facebook")
            val fb = if (fbObj != null) {
                FbSelectorConfig(
                    primaryUrl = fbObj.optString("primaryUrl", "https://m.facebook.com/groups/?category=membership"),
                    fallbackUrl = fbObj.optString("fallbackUrl", "https://www.facebook.com/groups/joins/"),
                    checkpointIndicatorSelectors = fbObj.optJSONArray("checkpointIndicatorSelectors")?.let { arr ->
                        (0 until arr.length()).map { arr.getString(it) }
                    } ?: listOf("#checkpointSubmitButton", "[id*='checkpoint']"),
                    loginIndicatorSelectors = fbObj.optJSONArray("loginIndicatorSelectors")?.let { arr ->
                        (0 until arr.length()).map { arr.getString(it) }
                    } ?: listOf("input[name='email']", "input[name='pass']"),
                    groupItemLinkSelector = fbObj.optString("groupItemLinkSelector", "a[href*='/groups/']"),
                    groupCardContainer = fbObj.optString("groupCardContainer", "div[role='feed'] > div"),
                    nameSelector = fbObj.optString("nameSelector", "span, strong, h3"),
                    memberCountSelector = fbObj.optString("memberCountSelector", "div, span"),
                    excludedPathIds = fbObj.optJSONArray("excludedPathIds")?.let { arr ->
                        (0 until arr.length()).map { arr.getString(it) }
                    } ?: listOf("feed", "discover", "notifications", "joins", "create", "search", "chats", "member")
                )
            } else FbSelectorConfig()

            val zaloObj = root.optJSONObject("zalo")
            val zalo = if (zaloObj != null) {
                ZaloSelectorConfig(
                    url = zaloObj.optString("url", "https://chat.zalo.me"),
                    qrLoginSelector = zaloObj.optString("qrLoginSelector", "#qr-container, .qrcode-img, [class*='qrcode']"),
                    loggedInSelector = zaloObj.optString("loggedInSelector", "#conversationList, div[data-id='virtual-list']"),
                    virtualListSelector = zaloObj.optString("virtualListSelector", "#conversationList, .conv-list, .virtualized-scroll"),
                    chatItemSelector = zaloObj.optString("chatItemSelector", ".conv-item, [data-id*='conv_item']"),
                    titleSelector = zaloObj.optString("titleSelector", ".conv-item-title__more, .conv-item-title"),
                    lastMsgTimeSelector = zaloObj.optString("lastMsgTimeSelector", ".conv-item-time, [class*='time']"),
                    groupAvatarSelector = zaloObj.optString("groupAvatarSelector", ".avatar-group, .avatar--group"),
                    contactsTabSelector = zaloObj.optString("contactsTabSelector", "[data-id='btn_Main_Tab_Contact']"),
                    groupSubTabSelector = zaloObj.optString("groupSubTabSelector", "[data-id='sub_tab_group']"),
                    groupListItemSelector = zaloObj.optString("groupListItemSelector", ".group-item, [data-id*='group_item']")
                )
            } else ZaloSelectorConfig()

            val safetyObj = root.optJSONObject("safety")
            val safety = if (safetyObj != null) {
                SafetyConfig(
                    minDelayMs = safetyObj.optLong("minDelayMs", 1500L),
                    maxDelayMs = safetyObj.optLong("maxDelayMs", 3500L),
                    enrichMinDelayMs = safetyObj.optLong("enrichMinDelayMs", 5000L),
                    enrichMaxDelayMs = safetyObj.optLong("enrichMaxDelayMs", 10000L),
                    maxFbGroups = safetyObj.optInt("maxFbGroups", 300),
                    maxConsecutiveStallCount = safetyObj.optInt("maxConsecutiveStallCount", 3)
                )
            } else SafetyConfig()

            return FullScannerConfig(fb, zalo, safety)
        }
    }
}
