package com.example.posthub.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.entity.FbGroupEntity
import com.example.posthub.domain.model.JoinStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun FacebookScreen(
    initialUrl: String? = null
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val container = JammyApp.instance.container
    val secureStore = container.secureStore
    val fbSession = container.fbWebSession

    DisposableEffect(Unit) {
        fbSession.isUserBrowsingScreen = true
        onDispose {
            fbSession.isUserBrowsingScreen = false
        }
    }

    val assistedSession by fbSession.assistedSession.collectAsState()
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

                Spacer(modifier = Modifier.height(6.dp))

                // Phím tắt mở trang Nhóm và Quét nhóm trực tiếp từ màn hình Facebook
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = {
                            webViewInstance?.loadUrl("https://www.facebook.com/groups/joins/")
                            Toast.makeText(context, "Đang mở trang danh sách nhóm...", Toast.LENGTH_SHORT).show()
                        },
                        modifier = Modifier.weight(1f).height(38.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
                    ) {
                        Icon(Icons.Default.Groups, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Đến trang nhóm", fontSize = 12.sp)
                    }

                    Button(
                        onClick = {
                            val wv = webViewInstance
                            if (wv == null) {
                                Toast.makeText(context, "WebView chưa sẵn sàng!", Toast.LENGTH_SHORT).show()
                                return@Button
                            }
                            scope.launch {
                                Toast.makeText(context, "Đang bóc tách nhóm từ màn hình...", Toast.LENGTH_SHORT).show()
                                val groups = fbSession.extractGroupsFromCurrentView(wv)
                                if (groups.isEmpty()) {
                                    Toast.makeText(context, "Chưa thấy nhóm trên màn hình. Bạn hãy cuộn trang đến danh sách nhóm rồi bấm lại nhé!", Toast.LENGTH_LONG).show()
                                } else {
                                    var newCount = 0
                                    withContext(Dispatchers.IO) {
                                        for (g in groups) {
                                            val existing = container.database.fbGroupDao().getGroupByUrl(g.url)
                                            if (existing == null) {
                                                container.database.fbGroupDao().insertGroup(
                                                    FbGroupEntity(name = g.name, url = g.url, joinStatus = JoinStatus.JOINED)
                                                )
                                                newCount++
                                            }
                                        }
                                    }
                                    Toast.makeText(context, "Quét thành công ${groups.size} nhóm (thêm mới $newCount nhóm)!", Toast.LENGTH_LONG).show()
                                }
                            }
                        },
                        modifier = Modifier.weight(1.3f).height(38.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                    ) {
                        Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Quét nhóm từ màn hình", fontSize = 12.sp)
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

        // Thanh điều hướng Đăng trợ lực nhiều nhóm liên tiếp
        assistedSession?.let { session ->
            ElevatedCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            ) {
                Column(modifier = Modifier.padding(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "🚀 Đang Đăng Trợ Lực (${session.progressDisplay})",
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                            Text(
                                text = session.currentGroup()?.name ?: "",
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f)
                            )
                        }
                        IconButton(onClick = { fbSession.cancelAssistedSession() }) {
                            Icon(Icons.Default.Close, contentDescription = "Hủy chuỗi", tint = MaterialTheme.colorScheme.error)
                        }
                    }

                    Spacer(modifier = Modifier.height(6.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                val clip = ClipData.newPlainText("PostContent", session.currentContent())
                                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
                                Toast.makeText(context, "Đã sao chép bài viết vào bộ nhớ tạm!", Toast.LENGTH_SHORT).show()
                            },
                            modifier = Modifier.weight(1f).height(36.dp)
                        ) {
                            Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Copy", fontSize = 11.sp)
                        }

                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    Toast.makeText(context, "Đang mở và điền bài viết...", Toast.LENGTH_SHORT).show()
                                    fbSession.fillActiveComposer(session.currentContent())
                                }
                            },
                            modifier = Modifier.weight(1f).height(36.dp)
                        ) {
                            Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Điền bài", fontSize = 11.sp)
                        }

                        Button(
                            onClick = {
                                if (session.hasNext()) {
                                    fbSession.nextAssistedGroup()
                                } else {
                                    fbSession.cancelAssistedSession()
                                    Toast.makeText(context, "🎉 Đã hoàn tất đăng trợ lực tất cả các nhóm!", Toast.LENGTH_LONG).show()
                                }
                            },
                            modifier = Modifier.weight(1.4f).height(36.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                        ) {
                            Icon(Icons.Default.ArrowForward, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = if (session.hasNext()) "Sang nhóm ${session.currentIndex + 2}" else "Hoàn tất",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
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
