package com.example.posthub.ui.screens

import android.view.ViewGroup
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlaylistAddCheck
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.example.posthub.zalo.DetectedZaloGroup

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ZaloWebScreen() {
    val context = LocalContext.current
    val container = JammyApp.instance.container
    val zaloSession = container.zaloWebSession
    val secureStore = container.secureStore

    val activeConversation by zaloSession.jsBridge.activeConversation.collectAsState()
    val scannedGroups by zaloSession.scannedGroups.collectAsState()
    val isScanning by zaloSession.isScanning.collectAsState()

    var monitoredGroups by remember { mutableStateOf(secureStore.getMonitoredZaloGroups()) }
    var showScanDialog by remember { mutableStateOf(false) }
    var showHelpDialog by remember { mutableStateOf(false) }

    val isCurrentMonitored = activeConversation.isNotBlank() && secureStore.isGroupMonitored(activeConversation)

    Column(modifier = Modifier.fillMaxSize()) {
        // Thanh công cụ điều khiển thông minh Zalo Web
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.surfaceVariant,
            tonalElevation = 2.dp
        ) {
            Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Hiển thị nhóm đang mở trên Zalo Web
                    Row(
                        modifier = Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Group,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Column {
                            Text(
                                text = if (activeConversation.isNotBlank()) activeConversation else "Mở 1 nhóm để chọn theo dõi",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "Đang theo dõi: ${monitoredGroups.size} nhóm",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    }

                    // Nút quét nhóm từ sidebar
                    OutlinedButton(
                        onClick = {
                            zaloSession.scanGroups()
                            showScanDialog = true
                        },
                        contentPadding = ButtonDefaults.TextButtonContentPadding,
                        modifier = Modifier.padding(start = 4.dp)
                    ) {
                        Icon(Icons.Default.PlaylistAddCheck, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Quét nhóm", fontSize = 12.sp)
                    }

                    IconButton(
                        onClick = {
                            val wv = zaloSession.getOrCreateWebView(context)
                            wv.loadUrl("https://chat.zalo.me")
                        }
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "Tải lại Zalo Web", modifier = Modifier.size(18.dp))
                    }

                    IconButton(onClick = { showHelpDialog = true }) {
                        Icon(Icons.Default.Info, contentDescription = "Hướng dẫn", modifier = Modifier.size(18.dp))
                    }
                }

                // Dòng nút chọn nhanh nhóm hiện tại (1 Chạm Không Cần Nhập)
                if (activeConversation.isNotBlank()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = if (isCurrentMonitored) "✓ Nhóm này đang được thu thập tin" else "Chưa theo dõi nhóm này",
                            fontSize = 11.sp,
                            color = if (isCurrentMonitored) Color(0xFF2E7D32) else MaterialTheme.colorScheme.outline
                        )

                        if (isCurrentMonitored) {
                            OutlinedButton(
                                onClick = {
                                    secureStore.removeMonitoredZaloGroup(activeConversation)
                                    monitoredGroups = secureStore.getMonitoredZaloGroups()
                                    Toast.makeText(context, "Đã ngừng theo dõi: $activeConversation", Toast.LENGTH_SHORT).show()
                                },
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFD32F2F)),
                                modifier = Modifier.height(32.dp)
                            ) {
                                Text("Bỏ theo dõi", fontSize = 11.sp)
                            }
                        } else {
                            Button(
                                onClick = {
                                    secureStore.addMonitoredZaloGroup(activeConversation)
                                    monitoredGroups = secureStore.getMonitoredZaloGroups()
                                    Toast.makeText(context, "Đã bắt đầu theo dõi: $activeConversation", Toast.LENGTH_SHORT).show()
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32)),
                                modifier = Modifier.height(32.dp)
                            ) {
                                Icon(Icons.Default.GroupAdd, contentDescription = null, modifier = Modifier.size(14.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Theo dõi nhóm này", fontSize = 11.sp)
                            }
                        }
                    }
                }
            }
        }

        // Nhúng WebView Zalo Web
        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                factory = { ctx ->
                    val wv = zaloSession.getOrCreateWebView(ctx)
                    val parent = wv.parent as? ViewGroup
                    parent?.removeView(wv)
                    wv
                },
                modifier = Modifier.fillMaxSize()
            )
        }
    }

    // Dialog danh sách chọn nhóm quét được từ Zalo Web
    if (showScanDialog) {
        AlertDialog(
            onDismissRequest = { showScanDialog = false },
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.PlaylistAddCheck, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Chọn nhóm Zalo cần lấy tin")
                }
            },
            text = {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Tích chọn nhóm bạn muốn tự động lấy tin nhắn đăng lên Facebook:",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                    Spacer(modifier = Modifier.height(8.dp))

                    if (isScanning) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp))
                            Spacer(modifier = Modifier.width(10.dp))
                            Text("Đang quét hội thoại...")
                        }
                    } else if (scannedGroups.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFFF5F5F5), RoundedCornerShape(8.dp))
                                .padding(12.dp)
                        ) {
                            Text(
                                text = "Chưa phát hiện nhóm nào trên thanh bên Zalo.\n\nHãy đảm bảo bạn đã đăng nhập Zalo Web và mở danh sách chat bên trái.",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxWidth().height(260.dp)) {
                            items(scannedGroups) { group ->
                                val isChecked = monitoredGroups.any { it.equals(group.name, ignoreCase = true) }
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Checkbox(
                                        checked = isChecked,
                                        onCheckedChange = { checked ->
                                            if (checked) {
                                                secureStore.addMonitoredZaloGroup(group.name)
                                            } else {
                                                secureStore.removeMonitoredZaloGroup(group.name)
                                            }
                                            monitoredGroups = secureStore.getMonitoredZaloGroups()
                                        }
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = group.name,
                                        style = MaterialTheme.typography.bodyMedium,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                Button(onClick = { showScanDialog = false }) {
                    Text("Xong (${monitoredGroups.size} nhóm)")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        zaloSession.scanGroups()
                    }
                ) {
                    Text("Quét lại")
                }
            }
        )
    }

    // Dialog hướng dẫn sử dụng Zalo Web
    if (showHelpDialog) {
        AlertDialog(
            onDismissRequest = { showHelpDialog = false },
            title = { Text("Hướng dẫn Zalo Web") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "1. Đăng nhập 1 lần:\nQuét mã QR bằng ứng dụng Zalo trên điện thoại. Phiên làm việc sẽ được lưu vĩnh viễn.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = "2. Chọn nhóm cần lấy tin (0 Cần Nhập):\n- Cách 1: Bấm vào nhóm bạn muốn trong danh sách chat -> Nút 'Theo dõi nhóm này' sẽ hiện ra ở thanh đầu -> Bấm để theo dõi.\n- Cách 2: Bấm nút 'Quét nhóm' ở góc trên để tích chọn hàng loạt.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = "3. Cơ chế hoạt động:\nKhi có tin nhắn mới từ các nhóm bạn đã chọn, app tự động bóc tách nội dung, gửi qua AI (nếu bật) và tạo bài sẵn sàng đăng lên Facebook!",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            },
            confirmButton = {
                Button(onClick = { showHelpDialog = false }) {
                    Text("Đã hiểu")
                }
            }
        )
    }
}
