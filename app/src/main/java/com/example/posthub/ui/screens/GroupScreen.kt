package com.example.posthub.ui.screens

import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.posthub.data.local.entity.GroupEntity
import com.example.posthub.scanner.GroupScannerViewModel
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupScreen(
    onOpenGroupInFb: (String) -> Unit = {},
    vm: GroupScannerViewModel = viewModel()
) {
    val context = LocalContext.current
    val filterState by vm.filterState.collectAsState()
    val scannerState by vm.scannerState.collectAsState()
    val groupList by vm.groups.collectAsState()
    val categories by vm.categories.collectAsState()
    val areas by vm.areas.collectAsState()

    var editingGroup by remember { mutableStateOf<GroupEntity?>(null) }
    var showEnrichConfirm by remember { mutableStateOf(false) }

    // Thông báo lỗi nếu có
    LaunchedEffect(scannerState.error) {
        scannerState.error?.let { err ->
            Toast.makeText(context, err, Toast.LENGTH_LONG).show()
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {

            // 1. Tab nền tảng: Facebook vs Zalo
            TabRow(selectedTabIndex = if (filterState.platform == "fb") 0 else 1) {
                Tab(
                    selected = filterState.platform == "fb",
                    onClick = { vm.setPlatform("fb") },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Groups, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Facebook", fontWeight = FontWeight.SemiBold)
                        }
                    }
                )
                Tab(
                    selected = filterState.platform == "zalo",
                    onClick = { vm.setPlatform("zalo") },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Chat, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Zalo Web", fontWeight = FontWeight.SemiBold)
                        }
                    }
                )
            }

            // 2. Thanh tìm kiếm & nút Đồng Bộ
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = filterState.searchQuery,
                    onValueChange = { vm.setSearchQuery(it) },
                    placeholder = { Text("Tìm theo tên nhóm...") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    trailingIcon = {
                        if (filterState.searchQuery.isNotEmpty()) {
                            IconButton(onClick = { vm.setSearchQuery("") }) {
                                Icon(Icons.Default.Close, contentDescription = "Xóa")
                            }
                        }
                    }
                )

                if (scannerState.isScanning) {
                    Button(
                        onClick = { vm.stopSync() },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                    ) {
                        Icon(Icons.Default.Stop, contentDescription = null)
                        Spacer(Modifier.width(4.dp))
                        Text("Dừng")
                    }
                } else {
                    Button(
                        onClick = {
                            if (filterState.platform == "fb") {
                                showEnrichConfirm = true
                            } else {
                                vm.startSync(false)
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        Icon(Icons.Default.Sync, contentDescription = null)
                        Spacer(Modifier.width(4.dp))
                        Text("Đồng bộ")
                    }
                }
            }

            // 3. Tiến trình quét (Khi đang đồng bộ)
            if (scannerState.isScanning) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f))
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "🔍 ${scannerState.statusMessage} (Đã gom: ${scannerState.progressCount} nhóm)",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }

            // 4. Lọc theo Category & Area Chips
            if (categories.isNotEmpty() || areas.isNotEmpty()) {
                LazyRow(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    item {
                        FilterChip(
                            selected = filterState.selectedCategory == null && filterState.selectedArea == null,
                            onClick = {
                                vm.setCategory(null)
                                vm.setArea(null)
                            },
                            label = { Text("Tất cả") }
                        )
                    }
                    items(categories) { cat ->
                        FilterChip(
                            selected = filterState.selectedCategory == cat,
                            onClick = {
                                vm.setCategory(if (filterState.selectedCategory == cat) null else cat)
                            },
                            label = { Text(cat) }
                        )
                    }
                    items(areas) { area ->
                        FilterChip(
                            selected = filterState.selectedArea == area,
                            onClick = {
                                vm.setArea(if (filterState.selectedArea == area) null else area)
                            },
                            label = { Text("📍 $area") }
                        )
                    }
                }
            }

            // 5. Thanh Thống kê & Nút Chọn / Bỏ Chọn / Export
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val activeCount = groupList.count { it.enabled }
                Text(
                    text = "Tổng: ${groupList.size} nhóm (Đang bật: $activeCount)",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium
                )

                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { vm.toggleAll(true) }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)) {
                        Text("Bật hết", fontSize = 11.sp)
                    }
                    TextButton(onClick = { vm.toggleAll(false) }, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)) {
                        Text("Tắt hết", fontSize = 11.sp)
                    }
                    IconButton(
                        onClick = {
                            try {
                                val exportDir = File(context.cacheDir, "exports").apply { mkdirs() }
                                val file = File(exportDir, "groups_${filterState.platform}_${System.currentTimeMillis()}.csv")
                                vm.exportToCsv(file)

                                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/csv"
                                    putExtra(Intent.EXTRA_STREAM, uri)
                                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                }
                                context.startActivity(Intent.createChooser(shareIntent, "Xuất danh sách nhóm"))
                            } catch (e: Exception) {
                                Toast.makeText(context, "Lỗi xuất file: ${e.message}", Toast.LENGTH_SHORT).show()
                            }
                        },
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(Icons.Default.FileDownload, contentDescription = "Export CSV", modifier = Modifier.size(16.dp))
                    }
                }
            }

            // 6. Danh sách các thẻ nhóm
            if (groupList.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.GroupAdd,
                            contentDescription = null,
                            modifier = Modifier.size(56.dp),
                            tint = Color.Gray.copy(alpha = 0.5f)
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            text = if (filterState.searchQuery.isNotBlank()) "Không tìm thấy nhóm phù hợp."
                                   else "Chưa có nhóm ${if (filterState.platform == "fb") "Facebook" else "Zalo"} nào.",
                            fontSize = 14.sp,
                            color = Color.Gray
                        )
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = { vm.startSync(false) }) {
                            Text("Bấm vào đây để Đồng Bộ Nhóm")
                        }
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(groupList, key = { it.id }) { group ->
                        UnifiedGroupCard(
                            group = group,
                            onToggle = { vm.toggleGroup(group) },
                            onEdit = { editingGroup = group },
                            onDelete = { vm.deleteGroup(group.id) },
                            onOpen = {
                                if (group.platform == "fb") {
                                    val url = if (group.externalId.startsWith("http")) group.externalId else "https://facebook.com/groups/${group.externalId}/"
                                    onOpenGroupInFb(url)
                                }
                            }
                        )
                    }
                }
            }
        }

        // Hộp thoại xác nhận làm giàu dữ liệu Facebook
        if (showEnrichConfirm) {
            AlertDialog(
                onDismissRequest = { showEnrichConfirm = false },
                title = { Text("Tùy chọn đồng bộ Facebook") },
                text = {
                    Text("Bạn muốn đồng bộ nhanh danh sách nhóm hay làm giàu chi tiết (trích xuất quyền đăng bài, nội quy nhóm với giãn cách an toàn 5-10s)?")
                },
                confirmButton = {
                    Button(onClick = {
                        showEnrichConfirm = false
                        vm.startSync(enrichDetails = true)
                    }) {
                        Text("Quét sâu & Làm giàu")
                    }
                },
                dismissButton = {
                    TextButton(onClick = {
                        showEnrichConfirm = false
                        vm.startSync(enrichDetails = false)
                    }) {
                        Text("Quét nhanh")
                    }
                }
            )
        }

        // Hộp thoại chỉnh sửa Category / Area / Priority
        editingGroup?.let { g ->
            EditGroupMetadataDialog(
                group = g,
                onDismiss = { editingGroup = null },
                onSave = { cat, area, prio ->
                    vm.updateMetadata(g.id, cat, area, prio)
                    editingGroup = null
                }
            )
        }
    }
}

@Composable
fun UnifiedGroupCard(
    group: GroupEntity,
    onToggle: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onOpen: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (group.enabled) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (group.enabled) 2.dp else 0.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Checkbox(
                checked = group.enabled,
                onCheckedChange = { onToggle() }
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 8.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = group.name,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        maxLines = 2,
                        modifier = Modifier.weight(1f)
                    )
                    if (group.priority > 0) {
                        Surface(
                            shape = RoundedCornerShape(4.dp),
                            color = if (group.priority >= 2) Color(0xFFFF9800) else Color(0xFF2196F3)
                        ) {
                            Text(
                                text = if (group.priority >= 2) "ƯU TIÊN CAO" else "ƯU TIÊN",
                                fontSize = 9.sp,
                                color = Color.White,
                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }

                if (!group.memberCount.isNullOrBlank()) {
                    Text(
                        text = "👥 ${group.memberCount}",
                        fontSize = 11.sp,
                        color = Color.Gray
                    )
                }

                Row(
                    modifier = Modifier.padding(top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    group.category?.let {
                        SuggestionChip(
                            onClick = onEdit,
                            label = { Text(it, fontSize = 10.sp) },
                            modifier = Modifier.height(24.dp)
                        )
                    }
                    group.area?.let {
                        SuggestionChip(
                            onClick = onEdit,
                            label = { Text("📍 $it", fontSize = 10.sp) },
                            modifier = Modifier.height(24.dp)
                        )
                    }
                    if (group.isLeft) {
                        SuggestionChip(
                            onClick = {},
                            label = { Text("Đã rời", fontSize = 10.sp, color = Color.Red) },
                            modifier = Modifier.height(24.dp)
                        )
                    }
                }
            }

            IconButton(onClick = onEdit, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Default.Edit, contentDescription = "Sửa", tint = Color.Gray, modifier = Modifier.size(16.dp))
            }
            if (group.platform == "fb") {
                IconButton(onClick = onOpen, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.OpenInBrowser, contentDescription = "Mở", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                }
            }
            IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Default.Delete, contentDescription = "Xóa", tint = Color.Gray.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
fun EditGroupMetadataDialog(
    group: GroupEntity,
    onDismiss: () -> Unit,
    onSave: (category: String?, area: String?, priority: Int) -> Unit
) {
    var category by remember { mutableStateOf(group.category ?: "") }
    var area by remember { mutableStateOf(group.area ?: "") }
    var priority by remember { mutableStateOf(group.priority) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Chỉnh sửa nhóm", fontSize = 16.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(text = group.name, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)

                OutlinedTextField(
                    value = category,
                    onValueChange = { category = it },
                    label = { Text("Chủ đề (Category)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = area,
                    onValueChange = { area = it },
                    label = { Text("Khu vực (Area)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                Text("Độ ưu tiên đăng bài:", fontSize = 12.sp, fontWeight = FontWeight.Medium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = priority == 0,
                        onClick = { priority = 0 },
                        label = { Text("Bình thường") }
                    )
                    FilterChip(
                        selected = priority == 1,
                        onClick = { priority = 1 },
                        label = { Text("Cao") }
                    )
                    FilterChip(
                        selected = priority == 2,
                        onClick = { priority = 2 },
                        label = { Text("Rất cao") }
                    )
                }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(category, area, priority) }) {
                Text("Lưu")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Hủy")
            }
        }
    )
}
