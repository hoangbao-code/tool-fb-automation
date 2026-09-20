package com.example.posthub.ui.screens

import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog

@Composable
fun FacebookScreen(
    initialUrl: String? = null
) {
    val context = LocalContext.current
    val container = JammyApp.instance.container
    val secureStore = container.secureStore
    val fbSession = container.fbWebSession

    var isEmergencyStop by remember { mutableStateOf(secureStore.isEmergencyStop()) }
    var accountName by remember { mutableStateOf(secureStore.getFbAccountName()) }
    var webViewInstance by remember { mutableStateOf<WebView?>(null) }

    Column(modifier = Modifier.fillMaxSize()) {
        // Thanh trạng thái Facebook & Nút dừng khẩn cấp
        Surface(
            modifier = Modifier.fillMaxWidth(),
            tonalElevation = 3.dp
        ) {
            Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = if (fbSession.isLoggedIn()) "🟢 Đã đăng nhập" else "🔴 Chưa đăng nhập",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = if (fbSession.isLoggedIn()) Color(0xFF2E7D32) else Color(0xFFC62828)
                        )
                        Text(
                            text = if (accountName.isNotBlank()) accountName else "Tự nhập mật khẩu/2FA trong WebView bên dưới",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    // Nút Dừng khẩn cấp
                    Button(
                        onClick = {
                            val newStop = !isEmergencyStop
                            isEmergencyStop = newStop
                            secureStore.setEmergencyStop(newStop)
                            val msg = if (newStop) "ĐÃ KÍCH HOẠT DỪNG KHẨN CẤP!" else "Đã hủy Dừng khẩn cấp."
                            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isEmergencyStop) Color(0xFFD32F2F) else Color(0xFFE65100)
                        )
                    ) {
                        Icon(Icons.Default.Warning, contentDescription = null)
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(if (isEmergencyStop) "ĐANG DỪNG" else "Dừng Khẩn")
                    }
                }

                Spacer(modifier = Modifier.padding(vertical = 2.dp))

                // Các phím điều hướng WebView
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row {
                        IconButton(onClick = { webViewInstance?.loadUrl("https://m.facebook.com") }) {
                            Icon(Icons.Default.Home, contentDescription = "Trang chủ FB")
                        }
                        IconButton(onClick = { webViewInstance?.reload() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Tải lại")
                        }
                    }

                    Row {
                        OutlinedButton(
                            onClick = { fbSession.openLoginPage() }
                        ) {
                            Text("Đăng nhập", fontSize = 12.sp)
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        OutlinedButton(
                            onClick = {
                                CookieManager.getInstance().removeAllCookies(null)
                                CookieManager.getInstance().flush()
                                secureStore.clearFbSession()
                                accountName = ""
                                webViewInstance?.loadUrl("https://m.facebook.com/login")
                                Toast.makeText(context, "Đã xóa toàn bộ cookie Facebook!", Toast.LENGTH_SHORT).show()
                            }
                        ) {
                            Text("Đăng xuất", fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        // Cảnh báo nếu đang Dừng khẩn cấp
        if (isEmergencyStop) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFD32F2F))
                    .padding(8.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "⚠️ Ứng dụng đang trong trạng thái DỪNG KHẨN CẤP! Mọi thao tác tự động bị khóa.",
                    color = Color.White,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        // WebView Facebook di động
        AndroidView(
            factory = { ctx ->
                val wv = fbSession.getOrCreateWebView(ctx)
                (wv.parent as? ViewGroup)?.removeView(wv)
                wv.layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                webViewInstance = wv
                if (wv.url.isNullOrBlank()) {
                    val target = initialUrl ?: "https://m.facebook.com"
                    wv.loadUrl(target)
                }
                wv
            },
            update = { wv ->
                webViewInstance = wv
            },
            modifier = Modifier.fillMaxSize()
        )
    }
}
