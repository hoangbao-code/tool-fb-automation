package com.example.posthub.ui.screens

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
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.TravelExplore
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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
import com.example.posthub.fb.DiscoveredGroup
import com.example.posthub.fb.JitterPolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupScreen(
    onOpenGroupInFb: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val container = JammyApp.instance.container
    val db = container.database
    val fbSession = container.fbWebSession
    val secureStore = container.secureStore

    val groups by db.fbGroupDao().getAllGroupsFlow().collectAsState(initial = emptyList())
    var searchQuery by remember { mutableStateOf("") }

    var isScanningJoined by remember { mutableStateOf(false) }
    var showSearchJoinDialog by remember { mutableStateOf(false) }
    var showManualAddDialog by remember { mutableStateOf(false) }

    val filteredGroups = remember(groups, searchQuery) {
        if (searchQuery.isBlank()) groups
        else groups.filter { it.name.contains(searchQuery, ignoreCase = true) || it.url.contains(searchQuery, ignoreCase = true) }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize().padding(12.dp)) {
            // Thanh công cụ tính năng tự động quét & tìm kiếm
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "Quản lý nhóm tự động (Không cần dán link)",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(10.dp))

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        // Nút 1: Quét nhóm đã tham gia
                        Button(
                            onClick = {
                                if (isScanningJoined) return@Button
                                isScanningJoined = true
                                scope.launch {
                                    val result = fbSession.scanJoinedGroups()
                                    if (result.isSuccess) {
                                        val discovered = result.getOrNull() ?: emptyList()
                                        var newAddedCount = 0
                                        withContext(Dispatchers.IO) {
                                            for (dg in discovered) {
                                                val existing = db.fbGroupDao().getGroupByUrl(dg.url)
                                                if (existing == null) {
                                                    db.fbGroupDao().insertGroup(
                                                        FbGroupEntity(
                                                            name = dg.name,
                                                            url = dg.url,
                                                            joinStatus = JoinStatus.JOINED
                                                        )
                                                    )
                                                    newAddedCount++
                                                }
                                            }
                                        }
                                        if (discovered.isEmpty()) {
                                            Toast.makeText(
                                                context,
                                                "Chưa tìm thấy nhóm. Bạn hãy sang tab 'Facebook', bấm 'Đến trang nhóm' rồi bấm 'Quét nhóm từ màn hình' nhé!",
                                                Toast.LENGTH_LONG
                                            ).show()
                                        } else {
                                            Toast.makeText(
                                                context,
                                                "Quét thành công! Tìm thấy ${discovered.size} nhóm (thêm mới $newAddedCount nhóm)!",
                                                Toast.LENGTH_LONG
                                            ).show()
                                        }
                                    } else {
                                        val err = result.exceptionOrNull()?.message ?: "Lỗi quét nhóm"
                                        Toast.makeText(context, "Lỗi: $err", Toast.LENGTH_LONG).show()
                                    }
                                    isScanningJoined = false
                                }
                            },
                            modifier = Modifier.weight(1f),
                            enabled = !isScanningJoined
                        ) {
                            if (isScanningJoined) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Đang quét...", fontSize = 11.sp)
                            } else {
                                Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Quét nhóm đã join", fontSize = 11.sp)
                            }
                        }

                        // Nút 2: Tìm & Auto-Join theo từ khóa
                        Button(
                            onClick = { showSearchJoinDialog = true },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary)
                        ) {
                            Icon(Icons.Default.TravelExplore, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Tìm & Auto Join", fontSize = 11.sp)
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Thanh tìm kiếm nhóm trong kho
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Lọc nhóm trong máy theo tên...") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true
            )

            Spacer(modifier = Modifier.height(10.dp))

            Text(
                text = "Danh sách nhóm trong máy (${filteredGroups.size})",
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
                            text = "Chưa có nhóm nào trong máy.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.outline
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Bấm 'Quét nhóm đã join' ở trên để app tự lấy toàn bộ nhóm từ Facebook của bạn!",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold
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

        // Nút thêm thủ công (dự phòng)
        FloatingActionButton(
            onClick = { showManualAddDialog = true },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
            containerColor = MaterialTheme.colorScheme.primaryContainer
        ) {
            Icon(Icons.Default.Add, contentDescription = "Thêm nhóm bằng link")
        }
    }

    // Modal Tìm kiếm & Tự động tham gia nhóm (Search & Auto-Join)
    if (showSearchJoinDialog) {
        var keywordInput by remember { mutableStateOf("") }
        var isSearching by remember { mutableStateOf(false) }
        var isAutoJoining by remember { mutableStateOf(false) }
        val searchResults = remember { mutableStateListOf<DiscoveredGroup>() }
        val answersList = remember { secureStore.getAnswerPool() }

        AlertDialog(
            onDismissRequest = { if (!isAutoJoining) showSearchJoinDialog = false },
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.TravelExplore, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Tìm & Auto-Join Nhóm", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
            },
            text = {
                Column(
                    modifier = Modifier.fillMaxWidth().height(420.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "Nhập từ khóa ngành nghề/khu vực (ví dụ: 'phòng trọ bình thạnh', 'cho thuê chdv sài gòn'):",
                        style = MaterialTheme.typography.bodySmall
                    )

                    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = keywordInput,
                            onValueChange = { keywordInput = it },
                            placeholder = { Text("Từ khóa tìm nhóm...") },
                            modifier = Modifier.weight(1f),
                            singleLine = true
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Button(
                            onClick = {
                                if (keywordInput.isNotBlank() && !isSearching) {
                                    isSearching = true
                                    searchResults.clear()
                                    scope.launch {
                                        val res = fbSession.searchGroupsByKeyword(keywordInput)
                                        if (res.isSuccess) {
                                            searchResults.addAll(res.getOrNull() ?: emptyList())
                                        } else {
                                            Toast.makeText(context, "Lỗi tìm kiếm: ${res.exceptionOrNull()?.message}", Toast.LENGTH_SHORT).show()
                                        }
                                        isSearching = false
                                    }
                                }
                            },
                            enabled = !isSearching && keywordInput.isNotBlank()
                        ) {
                            if (isSearching) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                            } else {
                                Text("Tìm")
                            }
                        }
                    }

                    if (searchResults.isNotEmpty()) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Kết quả tìm được (${searchResults.size}):", fontWeight = FontWeight.Bold, fontSize = 12.sp)

                            // Nút Auto-Join hàng loạt
                            Button(
                                onClick = {
                                    if (isAutoJoining) return@Button
                                    isAutoJoining = true
                                    scope.launch {
                                        val candidates = searchResults.filter { !it.isJoined }
                                        var joinedCount = 0
                                        for (group in candidates) {
                                            if (secureStore.isEmergencyStop()) break
                                            AppLog.i("GroupScreen", "Đang tự động tham gia nhóm: ${group.name} (${group.url})...")
                                            fbSession.joinGroupWithAnswers(group.url, answersList)

                                            // Lưu vào database với trạng thái REQUESTED
                                            withContext(Dispatchers.IO) {
                                                val existing = db.fbGroupDao().getGroupByUrl(group.url)
                                                if (existing == null) {
                                                    db.fbGroupDao().insertGroup(
                                                        FbGroupEntity(
                                                            name = group.name,
                                                            url = group.url,
                                                            joinStatus = JoinStatus.REQUESTED
                                                        )
                                                    )
                                                }
                                            }

                                            joinedCount++
                                            // Giãn cách ngẫu nhiên an toàn giữa các lượt join (10-20 giây)
                                            delay(JitterPolicy.calculateActionDelayMillis(10, 20))
                                        }
                                        isAutoJoining = false
                                        Toast.makeText(context, "Đã gửi yêu cầu tham gia $joinedCount nhóm!", Toast.LENGTH_LONG).show()
                                        showSearchJoinDialog = false
                                    }
                                },
                                enabled = !isAutoJoining && searchResults.any { !it.isJoined }
                            ) {
                                if (isAutoJoining) {
                                    CircularProgressIndicator(modifier = Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp)
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Đang Auto-Join...", fontSize = 11.sp)
                                } else {
                                    Icon(Icons.Default.GroupAdd, contentDescription = null, modifier = Modifier.size(14.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Auto-Join Tất Cả", fontSize = 11.sp)
                                }
                            }
                        }

                        LazyColumn(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            items(searchResults) { item ->
                                Card(
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(8.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(text = item.name, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                                            Text(text = item.url, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                                        }
                                        if (item.isJoined) {
                                            SuggestionChip(onClick = {}, label = { Text("Đã vào", fontSize = 10.sp, color = Color(0xFF388E3C)) })
                                        } else {
                                            OutlinedButton(
                                                onClick = {
                                                    scope.launch {
                                                        fbSession.joinGroupWithAnswers(item.url, answersList)
                                                        withContext(Dispatchers.IO) {
                                                            db.fbGroupDao().insertGroup(
                                                                FbGroupEntity(name = item.name, url = item.url, joinStatus = JoinStatus.REQUESTED)
                                                            )
                                                        }
                                                        Toast.makeText(context, "Đã gửi yêu cầu vào nhóm: ${item.name}", Toast.LENGTH_SHORT).show()
                                                    }
                                                },
                                                modifier = Modifier.height(32.dp)
                                            ) {
                                                Text("Join", fontSize = 11.sp)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(
                    onClick = { showSearchJoinDialog = false },
                    enabled = !isAutoJoining
                ) {
                    Text("Đóng")
                }
            }
        )
    }

    // Dialog thêm thủ công (dự phòng)
    if (showManualAddDialog) {
        var groupNameInput by remember { mutableStateOf("") }
        var groupUrlInput by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showManualAddDialog = false },
            title = { Text("Thêm nhóm bằng link URL") },
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
                        label = { Text("Link nhóm Facebook") },
                        placeholder = { Text("https://m.facebook.com/groups/...") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
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
                                        joinStatus = JoinStatus.JOINED
                                    )
                                )
                                withContext(Dispatchers.Main) {
                                    showManualAddDialog = false
                                    Toast.makeText(context, "Đã thêm nhóm!", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                ) {
                    Text("Lưu")
                }
            },
            dismissButton = {
                TextButton(onClick = { showManualAddDialog = false }) { Text("Hủy") }
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
        }
    }
}
