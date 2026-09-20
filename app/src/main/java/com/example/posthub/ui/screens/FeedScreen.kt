package com.example.posthub.ui.screens

import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.entity.PostEntity
import com.example.posthub.domain.model.PostSource
import com.example.posthub.domain.model.PostStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(
    onOpenPostReview: (Long) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = JammyApp.instance.container.database
    val converters = JammyApp.instance.container.converters

    val posts by db.postDao().getAllPostsFlow().collectAsState(initial = emptyList())
    var selectedFilter by remember { mutableStateOf<PostStatus?>(null) }
    var showNewPostDialog by remember { mutableStateOf(false) }
    var showCleanConfirmDialog by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        JammyApp.instance.container.purgeOldPostsAndLogs()
    }

    val filteredPosts = remember(posts, selectedFilter) {
        if (selectedFilter == null) posts else posts.filter { it.status == selectedFilter }
    }

    val pendingCount = posts.count { it.status == PostStatus.PENDING_REVIEW }
    val postedCount = posts.count { it.status == PostStatus.POSTED }

    Column(modifier = Modifier.fillMaxSize().padding(12.dp)) {
        // Thanh thống kê nhanh & Dán nhanh
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "Hộp thư tin đăng",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Chờ duyệt: $pendingCount • Đã đăng: $postedCount • Tổng: ${posts.size}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    Row {
                        // Nút dọn dẹp các bài đã đăng
                        if (postedCount > 0) {
                            IconButton(onClick = { showCleanConfirmDialog = true }) {
                                Icon(Icons.Default.DeleteSweep, contentDescription = "Dọn dẹp bài đã đăng", tint = MaterialTheme.colorScheme.error)
                            }
                        }

                        // Nút dán nhanh từ clipboard
                        IconButton(
                            onClick = {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                val clip = clipboard.primaryClip
                                if (clip != null && clip.itemCount > 0) {
                                    val text = clip.getItemAt(0).text?.toString() ?: ""
                                    if (text.isNotBlank()) {
                                        scope.launch {
                                            val newPost = PostEntity(
                                                rawText = text,
                                                cleanedText = text,
                                                finalPostText = text,
                                                source = PostSource.CLIPBOARD,
                                                senderOrGroup = "Dán từ Clipboard",
                                                status = PostStatus.PENDING_REVIEW
                                            )
                                            val id = withContext(Dispatchers.IO) { db.postDao().insertPost(newPost) }
                                            AppLog.i("FeedScreen", "Đã tạo tin mới từ Clipboard (ID: #$id)")
                                            Toast.makeText(context, "Đã dán tin mới thành công!", Toast.LENGTH_SHORT).show()
                                            onOpenPostReview(id)
                                        }
                                    } else {
                                        Toast.makeText(context, "Bộ nhớ tạm không có văn bản!", Toast.LENGTH_SHORT).show()
                                    }
                                } else {
                                    Toast.makeText(context, "Bộ nhớ tạm rỗng!", Toast.LENGTH_SHORT).show()
                                }
                            }
                        ) {
                            Icon(Icons.Default.ContentPaste, contentDescription = "Dán nhanh từ Clipboard")
                        }

                        // Nút tạo tin thủ công
                        IconButton(onClick = { showNewPostDialog = true }) {
                            Icon(Icons.Default.Add, contentDescription = "Tạo tin mới")
                        }
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Chips lọc trạng thái
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    FilterChip(
                        selected = selectedFilter == null,
                        onClick = { selectedFilter = null },
                        label = { Text("Tất cả (${posts.size})", fontSize = 12.sp) }
                    )
                    FilterChip(
                        selected = selectedFilter == PostStatus.PENDING_REVIEW,
                        onClick = {
                            selectedFilter = if (selectedFilter == PostStatus.PENDING_REVIEW) null else PostStatus.PENDING_REVIEW
                        },
                        label = { Text("Chờ duyệt ($pendingCount)", fontSize = 12.sp) }
                    )
                    FilterChip(
                        selected = selectedFilter == PostStatus.POSTED,
                        onClick = {
                            selectedFilter = if (selectedFilter == PostStatus.POSTED) null else PostStatus.POSTED
                        },
                        label = { Text("Đã đăng ($postedCount)", fontSize = 12.sp) }
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        // Danh sách các tin bài
        if (filteredPosts.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "Chưa có tin nào.",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.outline
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Hãy mở Zalo Web hoặc chia sẻ tin nhắn để gom bài đăng!",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(filteredPosts, key = { it.id }) { post ->
                    val photoList = converters.toStringList(post.photoPathsJson)
                    PostCardItem(
                        post = post,
                        photoCount = photoList.size,
                        onClick = { onOpenPostReview(post.id) },
                        onDelete = {
                            scope.launch(Dispatchers.IO) {
                                db.postDao().deletePost(post)
                                AppLog.i("FeedScreen", "Đã xóa bài viết ID #${post.id}")
                            }
                        }
                    )
                }
            }
        }
    }

    // Dialog xác nhận dọn dẹp các bài đã đăng
    if (showCleanConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showCleanConfirmDialog = false },
            title = { Text("Dọn dẹp bài đã đăng?") },
            text = { Text("Thao tác này sẽ xóa tất cả $postedCount bài viết 'Đã đăng' khỏi danh sách trong app để làm gọn hộp thư (tuyệt đối không xóa bài trên Facebook).") },
            confirmButton = {
                Button(
                    onClick = {
                        showCleanConfirmDialog = false
                        scope.launch(Dispatchers.IO) {
                            val count = db.postDao().deleteAllPostedPosts()
                            withContext(Dispatchers.Main) {
                                Toast.makeText(context, "Đã dọn dẹp $count bài đã đăng!", Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text("Xóa dọn dẹp")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCleanConfirmDialog = false }) {
                    Text("Hủy")
                }
            }
        )
    }

    // Dialog tạo tin mới bằng tay
    if (showNewPostDialog) {
        var inputContent by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showNewPostDialog = false },
            title = { Text("Tạo bài viết mới") },
            text = {
                OutlinedTextField(
                    value = inputContent,
                    onValueChange = { inputContent = it },
                    label = { Text("Nội dung bài viết") },
                    modifier = Modifier.fillMaxWidth().height(160.dp)
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (inputContent.isNotBlank()) {
                            scope.launch {
                                val newPost = PostEntity(
                                    rawText = inputContent,
                                    cleanedText = inputContent,
                                    finalPostText = inputContent,
                                    source = PostSource.MANUAL,
                                    senderOrGroup = "Nhập tay",
                                    status = PostStatus.PENDING_REVIEW
                                )
                                val id = withContext(Dispatchers.IO) { db.postDao().insertPost(newPost) }
                                showNewPostDialog = false
                                onOpenPostReview(id)
                            }
                        }
                    }
                ) {
                    Text("Tạo & Duyệt")
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewPostDialog = false }) {
                    Text("Hủy")
                }
            }
        )
    }
}

@Composable
private fun PostCardItem(
    post: PostEntity,
    photoCount: Int,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    val sdf = SimpleDateFormat("HH:mm - dd/MM", Locale.getDefault())
    val timeStr = sdf.format(Date(post.createdAt))

    val statusColor = when (post.status) {
        PostStatus.PENDING_REVIEW -> Color(0xFFF57C00)
        PostStatus.APPROVED -> Color(0xFF1976D2)
        PostStatus.QUEUED -> Color(0xFF7B1FA2)
        PostStatus.POSTING -> Color(0xFF0288D1)
        PostStatus.POSTED -> Color(0xFF388E3C)
        PostStatus.FAILED -> Color(0xFFD32F2F)
        PostStatus.REJECTED -> Color(0xFF757575)
    }

    val statusText = when (post.status) {
        PostStatus.PENDING_REVIEW -> "Chờ duyệt"
        PostStatus.APPROVED -> "Đã duyệt"
        PostStatus.QUEUED -> "Trong hàng đợi"
        PostStatus.POSTING -> "Đang đăng..."
        PostStatus.POSTED -> "Đã đăng"
        PostStatus.FAILED -> "Lỗi đăng"
        PostStatus.REJECTED -> "Đã hủy"
    }

    val sourceIcon = when (post.source) {
        PostSource.SHARE_TARGET -> Icons.Default.Share
        PostSource.NOTIFICATION -> Icons.Default.Notifications
        PostSource.CLIPBOARD -> Icons.Default.ContentPaste
        PostSource.MANUAL -> Icons.Default.Edit
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = sourceIcon,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = post.senderOrGroup,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .background(statusColor.copy(alpha = 0.15f), RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = statusText,
                            color = statusColor,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                    IconButton(
                        onClick = onDelete,
                        modifier = Modifier.size(24.dp)
                    ) {
                        Icon(
                            Icons.Default.Delete,
                            contentDescription = "Xóa",
                            tint = Color.Gray,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = post.finalPostText.ifBlank { post.rawText },
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = timeStr,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )

                if (photoCount > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Image,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.secondary
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "$photoCount ảnh",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary
                        )
                    }
                }
            }
        }
    }
}
