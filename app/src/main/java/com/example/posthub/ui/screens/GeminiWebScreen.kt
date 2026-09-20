package com.example.posthub.ui.screens

import android.view.ViewGroup
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.posthub.JammyApp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GeminiWebScreen(
    onBack: () -> Unit,
    onApplyResult: ((String) -> Unit)? = null
) {
    val context = LocalContext.current
    val geminiSession = JammyApp.instance.container.geminiWebSession
    val latestResponse by geminiSession.jsBridge.latestResponse.collectAsState()
    val isLoading by geminiSession.jsBridge.isLoading.collectAsState()

    Column(modifier = Modifier.fillMaxSize()) {
        // Thanh công cụ phía trên
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant,
            tonalElevation = 3.dp
        ) {
            Column(modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        modifier = Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.Default.ArrowBack, contentDescription = "Quay lại")
                        }
                        Icon(
                            imageVector = Icons.Default.AutoAwesome,
                            contentDescription = null,
                            tint = Color(0xFF673AB7),
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Column {
                            Text(
                                text = "Gemini Web (Cuộc trò chuyện)",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = if (isLoading) "Gemini đang suy nghĩ..." else "Mở chat cũ hoặc tạo chat mới",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (isLoading) Color(0xFFE65100) else MaterialTheme.colorScheme.outline
                            )
                        }
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (onApplyResult != null) {
                            Button(
                                onClick = {
                                    geminiSession.extractLatestResponse { res ->
                                        if (res.isNotBlank()) {
                                            onApplyResult(res)
                                            Toast.makeText(context, "Đã áp dụng kết quả từ Gemini Web!", Toast.LENGTH_SHORT).show()
                                            onBack()
                                        } else {
                                            Toast.makeText(context, "Chưa tìm thấy câu trả lời mới từ Gemini. Hãy đợi Gemini trả lời xong nhé!", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF673AB7)),
                                modifier = Modifier.height(34.dp)
                            ) {
                                Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Lấy kết quả", fontSize = 12.sp)
                            }
                        }

                        IconButton(
                            onClick = {
                                val wv = geminiSession.getOrCreateWebView(context)
                                wv.loadUrl("https://gemini.google.com/app")
                            }
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = "Tải lại trang")
                        }
                    }
                }
            }
        }

        // Nhúng WebView Gemini Web
        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                factory = { ctx ->
                    val wv = geminiSession.getOrCreateWebView(ctx)
                    val parent = wv.parent as? ViewGroup
                    parent?.removeView(wv)
                    wv
                },
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}
