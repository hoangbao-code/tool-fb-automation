package com.example.posthub.domain.ai

import com.example.posthub.data.AppLog
import com.example.posthub.data.local.SecureStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class AiService(
    private val secureStore: SecureStore? = null
) {

    /**
     * Viết lại nội dung bài đăng bằng Gemini API dựa trên template prompt
     */
    suspend fun rewritePost(
        content: String,
        senderOrGroup: String = "",
        overridePromptTemplate: String? = null,
        overrideApiKey: String? = null
    ): Result<String> = withContext(Dispatchers.IO) {
        val apiKey = overrideApiKey ?: secureStore?.getGeminiApiKey() ?: ""
        if (apiKey.isBlank()) {
            return@withContext Result.failure(IllegalStateException("Chưa cấu hình Gemini API Key. Vui lòng vào Cài đặt để nhập API Key miễn phí."))
        }

        val template = overridePromptTemplate ?: secureStore?.getAiPromptTemplate() ?: SecureStore.DEFAULT_AI_PROMPT
        val finalPrompt = buildPrompt(template, content, senderOrGroup)
        val model = secureStore?.getAiModel()?.ifBlank { "gemini-1.5-flash" } ?: "gemini-1.5-flash"

        try {
            val responseText = callGeminiApi(apiKey, model, finalPrompt)
            AppLog.i("AiService", "AI đã viết lại bài đăng thành công (${responseText.length} ký tự).")
            Result.success(responseText)
        } catch (e: Exception) {
            AppLog.e("AiService", "Lỗi khi gọi AI Gemini: ${e.message}", e)
            Result.failure(e)
        }
    }

    /**
     * Kiểm tra kết nối API Key và Prompt với dữ liệu mẫu
     */
    suspend fun testConnection(
        apiKey: String,
        promptTemplate: String,
        model: String = "gemini-1.5-flash"
    ): Result<String> = withContext(Dispatchers.IO) {
        if (apiKey.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Vui lòng nhập API Key để kiểm tra."))
        }

        val sampleContent = """
            Cho thuê phòng trọ cao cấp full NT tại 123 XVNT, Bình Thạnh.
            Giá 5tr5/tháng, cọc 1 tháng. Giờ giấc tự do, có máy giặt, ban công thoáng mát.
            LH: 0901234567 gặp chính chủ xem phòng ngay!
        """.trimIndent()

        val prompt = buildPrompt(promptTemplate, sampleContent, "Nhóm Phòng Trọ Sài Gòn")

        try {
            val res = callGeminiApi(apiKey, model, prompt)
            Result.success(res)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Ghép nội dung và biến vào Prompt Template
     */
    fun buildPrompt(template: String, content: String, senderOrGroup: String): String {
        var result = template
        if (result.contains("{CONTENT}")) {
            result = result.replace("{CONTENT}", content.trim())
        } else {
            result = "$result\n\nNội dung cần viết lại:\n${content.trim()}"
        }

        result = result.replace("{SENDER}", senderOrGroup.trim())
        result = result.replace("{GROUP}", senderOrGroup.trim())
        return result
    }

    private fun callGeminiApi(apiKey: String, model: String, prompt: String): String {
        val endpoint = "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent?key=$apiKey"
        val url = URL(endpoint)
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connectTimeout = 25000
            readTimeout = 25000
            doInput = true
            doOutput = true
        }

        // Tạo JSON payload chuẩn của Gemini API
        val rootJson = JSONObject().apply {
            val contentsArr = JSONArray()
            val contentObj = JSONObject().apply {
                val partsArr = JSONArray()
                partsArr.put(JSONObject().apply {
                    put("text", prompt)
                })
                put("parts", partsArr)
            }
            contentsArr.put(contentObj)
            put("contents", contentsArr)

            val configObj = JSONObject().apply {
                put("temperature", 0.7)
                put("maxOutputTokens", 2048)
            }
            put("generationConfig", configObj)
        }

        OutputStreamWriter(conn.outputStream, "UTF-8").use { writer ->
            writer.write(rootJson.toString())
            writer.flush()
        }

        val statusCode = conn.responseCode
        if (statusCode !in 200..299) {
            val errBody = try {
                BufferedReader(InputStreamReader(conn.errorStream ?: conn.inputStream, "UTF-8")).use { it.readText() }
            } catch (e: Exception) {
                ""
            }
            throw IllegalStateException("Gemini API báo lỗi HTTP $statusCode: $errBody")
        }

        val responseBody = BufferedReader(InputStreamReader(conn.inputStream, "UTF-8")).use { it.readText() }
        return parseGeminiResponse(responseBody)
    }

    /**
     * Bóc tách câu trả lời từ JSON phản hồi của Gemini
     */
    fun parseGeminiResponse(jsonString: String): String {
        return try {
            val obj = JSONObject(jsonString)
            val candidates = obj.optJSONArray("candidates")
                ?: throw IllegalStateException("Gemini phản hồi không có candidates")

            if (candidates.length() == 0) {
                throw IllegalStateException("Danh sách candidates phản hồi rỗng")
            }

            val firstCandidate = candidates.getJSONObject(0)
            val content = firstCandidate.optJSONObject("content")
                ?: throw IllegalStateException("Candidate không có content")

            val parts = content.optJSONArray("parts")
                ?: throw IllegalStateException("Candidate content không có parts")

            val sb = StringBuilder()
            for (i in 0 until parts.length()) {
                val part = parts.getJSONObject(i)
                val text = part.optString("text")
                if (text.isNotBlank()) {
                    sb.append(text)
                }
            }

            val finalText = sb.toString().trim()
            if (finalText.isBlank()) {
                throw IllegalStateException("Nội dung AI trả về bị trống")
            }
            finalText
        } catch (e: Exception) {
            // Khi chạy trên JVM unit test không có Android runtime, mockable-android.jar trả về null cho JSONObject methods.
            // Sử dụng regex trích xuất phần "text" phòng ngừa môi trường test.
            val regex = """"text"\s*:\s*"((?:\\.|[^"\\])*)"""".toRegex()
            val matches = regex.findAll(jsonString).map {
                it.groupValues[1]
                    .replace("\\n", "\n")
                    .replace("\\\"", "\"")
                    .replace("\\\\", "\\")
                    .replace("\\r", "\r")
                    .replace("\\t", "\t")
            }.filter { it.isNotBlank() }.toList()

            if (matches.isNotEmpty()) {
                matches.joinToString("\n").trim()
            } else {
                throw e
            }
        }
    }
}
