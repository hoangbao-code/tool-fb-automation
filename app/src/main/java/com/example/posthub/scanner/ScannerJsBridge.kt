package com.example.posthub.scanner

import android.webkit.JavascriptInterface
import com.example.posthub.data.AppLog
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import org.json.JSONObject

class ScannerJsBridge {

    sealed interface ScanEvent {
        data class OnBatchExtracted(val itemsJson: String) : ScanEvent
        data class OnLog(val message: String) : ScanEvent
        data class OnSelectorFailure(val selectorKey: String, val reason: String) : ScanEvent
        data class OnCheckpointDetected(val reason: String) : ScanEvent
        data class OnProgress(val count: Int, val isDone: Boolean) : ScanEvent
    }

    private val _events = MutableSharedFlow<ScanEvent>(extraBufferCapacity = 64)
    val events = _events.asSharedFlow()

    @JavascriptInterface
    fun postMessage(jsonString: String) {
        try {
            val json = JSONObject(jsonString)
            when (json.optString("type")) {
                "BATCH_ITEMS" -> {
                    _events.tryEmit(ScanEvent.OnBatchExtracted(json.optString("payload", "[]")))
                }
                "SELECTOR_ERROR" -> {
                    val sel = json.optString("selector", "")
                    val err = json.optString("error", "")
                    AppLog.w("ScannerJsBridge", "Selector không khớp: [$sel] -> Lý do: $err")
                    _events.tryEmit(ScanEvent.OnSelectorFailure(sel, err))
                }
                "CHECKPOINT" -> {
                    val reason = json.optString("reason", "Phát hiện trang bảo mật.")
                    AppLog.e("ScannerJsBridge", "Phát hiện Checkpoint/Bảo vệ: $reason")
                    _events.tryEmit(ScanEvent.OnCheckpointDetected(reason))
                }
                "PROGRESS" -> {
                    val count = json.optInt("count", 0)
                    val isDone = json.optBoolean("isDone", false)
                    _events.tryEmit(ScanEvent.OnProgress(count, isDone))
                }
                "LOG" -> {
                    val msg = json.optString("msg", "")
                    // Đảm bảo không log cookie/token
                    if (!msg.contains("cookie", ignoreCase = true) && !msg.contains("token", ignoreCase = true)) {
                        AppLog.d("ScannerJsBridge", msg)
                        _events.tryEmit(ScanEvent.OnLog(msg))
                    }
                }
            }
        } catch (e: Exception) {
            AppLog.e("ScannerJsBridge", "Lỗi xử lý postMessage: ${e.message}")
        }
    }
}
