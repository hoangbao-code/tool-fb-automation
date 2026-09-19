package com.example.posthub.ui.screens

import android.widget.Toast
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.entity.FbGroupEntity
import com.example.posthub.domain.model.JoinStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupScreen(
    onOpenGroupInFb: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = JammyApp.instance.container.database

    val groups by db.fbGroupDao().getAllGroupsFlow().collectAsState(initial = emptyList())
    var searchQuery by remember { mutableStateOf("") }
    var showAddDialog by remember { mutableStateOf(false) }

    val filteredGroups = remember(groups, searchQuery) {
        if (searchQuery.isBlank()) groups
        else groups.filter { it.name.contains(searchQuery, ignoreCase = true) || it.url.contains(searchQuery, ignoreCase = true) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize().padding(12.dp)) {
            // Thanh tìm kiếm
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Tìm kiếm nhóm theo tên hoặc link...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true
            )

            Spacer(modifier = Modifier.height(10.dp))

            // Thống kê nhóm
            Text(
                text = "Danh sách nhóm Facebook (${filteredGroups.size})",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(6.dp))

            if (filteredGroups.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.Groups,
                            contentDescription = null,
                            modifier = Modifier.size(56.dp),
                            tint = MaterialTheme.colorScheme.outline
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Chưa có nhóm nào trong danh sách.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.outline
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Bấm nút (+) bên dưới để dán link nhóm cần đăng bài!",
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
                    items(filteredGroups, key = { it.id }) { group ->
                        GroupCardItem(
                            group = group,
                            onOpenInFb = { onOpenGroupInFb(group.url) },
                            onDelete = {
                                scope.launch(Dispatchers.IO) {
                                    db.fbGroupDao().deleteGroup(group)
                                    AppLog.i("GroupScreen", "Đã xóa nhóm: ${group.name}")
                                }
                            }
                        )
                    }
                }
            }
        }

        // Nút thêm nhóm mới
        FloatingActionButton(
            onClick = { showAddDialog = true },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
            containerColor = MaterialTheme.colorScheme.primaryContainer
        ) {
            Icon(Icons.Default.Add, contentDescription = "Thêm nhóm mới")
        }
    }

    // Dialog thêm nhóm mới bằng URL
    if (showAddDialog) {
        var groupNameInput by remember { mutableStateOf("") }
        var groupUrlInput by remember { mutableStateOf("") }
        var rulesInput by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showAddDialog = false },
            title = { Text("Thêm nhóm Facebook mới") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = groupNameInput,
                        onValueChange = { groupNameInput = it },
                        label = { Text("Tên nhóm (gợi nhớ)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = groupUrlInput,
                        onValueChange = { groupUrlInput = it },
                        label = { Text("Link nhóm Facebook (URL)") },
                        placeholder = { Text("https://www.facebook.com/groups/...") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = rulesInput,
                        onValueChange = { rulesInput = it },
                        label = { Text("Ghi chú luật nhóm (tùy chọn)") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (groupUrlInput.isNotBlank()) {
                            val cleanName = if (groupNameInput.isNotBlank()) groupNameInput else "Nhóm FB (${groupUrlInput.takeLast(15)})"
                            scope.launch(Dispatchers.IO) {
                                db.fbGroupDao().insertGroup(
                                    FbGroupEntity(
                                        name = cleanName,
                                        url = groupUrlInput.trim(),
                                        rulesNote = rulesInput,
                                        joinStatus = JoinStatus.JOINED
                                    )
                                )
                                AppLog.i("GroupScreen", "Đã thêm nhóm mới: $cleanName ($groupUrlInput)")
                                withContext(Dispatchers.Main) {
                                    showAddDialog = false
                                    Toast.makeText(context, "Đã thêm nhóm thành công!", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                ) {
                    Text("Lưu nhóm")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddDialog = false }) {
                    Text("Hủy")
                }
            }
        )
    }
}

@Composable
private fun GroupCardItem(
    group: FbGroupEntity,
    onOpenInFb: () -> Unit,
    onDelete: () -> Unit
) {
    val statusColor = when (group.joinStatus) {
        JoinStatus.JOINED -> Color(0xFF388E3C)
        JoinStatus.REQUESTED -> Color(0xFFF57C00)
        JoinStatus.NEED_ANSWERS -> Color(0xFF0288D1)
        JoinStatus.NOT_JOINED -> Color(0xFF757575)
        JoinStatus.DECLINED, JoinStatus.BANNED -> Color(0xFFD32F2F)
        JoinStatus.LEFT -> Color.Gray
    }

    val statusLabel = when (group.joinStatus) {
        JoinStatus.JOINED -> "Đã tham gia"
        JoinStatus.REQUESTED -> "Đang chờ duyệt"
        JoinStatus.NEED_ANSWERS -> "Cần trả lời"
        JoinStatus.NOT_JOINED -> "Chưa tham gia"
        JoinStatus.DECLINED -> "Bị từ chối"
        JoinStatus.BANNED -> "Bị chặn"
        JoinStatus.LEFT -> "Đã rời nhóm"
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = group.name,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = group.url,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                }

                Row(verticalAlignment = Alignment.CenterVertically) {
                    SuggestionChip(
                        onClick = {},
                        label = { Text(statusLabel, fontSize = 11.sp, color = statusColor) }
                    )
                    IconButton(onClick = onOpenInFb) {
                        Icon(Icons.Default.OpenInBrowser, contentDescription = "Mở nhóm", tint = MaterialTheme.colorScheme.primary)
                    }
                    IconButton(onClick = onDelete) {
                        Icon(Icons.Default.Delete, contentDescription = "Xóa nhóm", tint = Color.Gray)
                    }
                }
            }

            if (group.rulesNote.isNotBlank()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Luật nhóm: ${group.rulesNote}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
