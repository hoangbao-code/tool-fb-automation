package com.example.posthub.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Pending
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.posthub.data.AppLog

@Composable
fun FeedScreen(
    onNavigateToLog: () -> Unit
) {
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Card Chào mừng M0
        ElevatedCard(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.elevatedCardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer
            )
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Jammy_post_hub (Mốc M0)",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Hệ thống khung dự án & CI/CD tự động đã sẵn sàng hoạt động trên điện thoại thật.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        // Nút thử nghiệm ghi log để kiểm tra tab Nhật ký
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant
            )
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Kiểm tra hệ thống Nhật ký",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Bấm nút dưới đây để phát một sự kiện log mẫu và chuyển sang tab Nhật ký để kiểm tra.",
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = {
                        AppLog.i("FeedScreen", "Người dùng bấm nút ghi log thử nghiệm từ màn hình Tin.")
                        AppLog.d("FeedScreen", "Chi tiết: Trạng thái bộ nhớ hoạt động bình thường.")
                        onNavigateToLog()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(imageVector = Icons.Default.Send, contentDescription = null)
                    Spacer(modifier = Modifier.padding(horizontal = 4.dp))
                    Text("Ghi Log Thử Nghiệm & Xem Ngay")
                }
            }
        }

        // Tiến độ Milestone
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface
            )
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    text = "Lộ trình triển khai",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(12.dp))

                MilestoneItem(
                    title = "M0: Khung dự án & CI/CD",
                    desc = "AGP 8.5.2, Gradle 8.7, dev.jks, AppLog in-app",
                    isDone = true
                )
                Spacer(modifier = Modifier.height(8.dp))
                MilestoneItem(
                    title = "M1: Bắt tin Zalo (Share + Notification)",
                    desc = "Bắt nội dung & ảnh từ Zalo, hướng dẫn cấp quyền Android 13+",
                    isDone = false
                )
                Spacer(modifier = Modifier.height(8.dp))
                MilestoneItem(
                    title = "M2: Facebook WebView (CỔNG QUYẾT ĐỊNH)",
                    desc = "Đăng nhập an toàn, kiểm tra session, đăng thử ASSISTED & AUTO",
                    isDone = false
                )
                Spacer(modifier = Modifier.height(8.dp))
                MilestoneItem(
                    title = "M3 - M6: Template, Merge, Group Manager",
                    desc = "Room DB, trích xuất biến cá nhân hóa, tự động hóa đăng tin",
                    isDone = false
                )
            }
        }
    }
}

@Composable
private fun MilestoneItem(
    title: String,
    desc: String,
    isDone: Boolean
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = if (isDone) Icons.Default.CheckCircle else Icons.Default.Pending,
            contentDescription = null,
            tint = if (isDone) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline
        )
        Spacer(modifier = Modifier.padding(horizontal = 6.dp))
        Column {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = if (isDone) FontWeight.Bold else FontWeight.Normal
            )
            Text(
                text = desc,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
