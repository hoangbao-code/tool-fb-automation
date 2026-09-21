package com.example.posthub.gemini

import android.webkit.JavascriptInterface
import com.example.posthub.data.AppLog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class GeminiJsBridge(
    private val onResponseCallback: (String) -> Unit = {}
) {
    private val _latestResponse = MutableStateFlow("")
    val latestResponse = _latestResponse.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading = _isLoading.asStateFlow()

    @JavascriptInterface
    fun onResponseExtracted(text: String) {
        val clean = text.trim()
        if (clean.isNotEmpty()) {
            AppLog.i("GeminiJsBridge", "Đã trích xuất câu trả lời từ Gemini Web (${clean.length} ký tự).")
            _latestResponse.value = clean
            onResponseCallback(clean)
        }
    }

    @JavascriptInterface
    fun onChatStateChanged(loading: Boolean) {
        _isLoading.value = loading
        AppLog.d("GeminiJsBridge", "Trạng thái Gemini: ${if (loading) "Đang suy nghĩ/trả lời..." else "Đã xong"}")
    }

    @JavascriptInterface
    fun log(tag: String, msg: String) {
        AppLog.d("GeminiWebJS", "[$tag] $msg")
    }
}
