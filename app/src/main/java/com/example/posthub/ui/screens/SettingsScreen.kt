package com.example.posthub.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.SystemUpdate
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.SecureStore
import com.example.posthub.data.local.entity.FieldDefEntity
import com.example.posthub.data.local.entity.TemplateEntity
import com.example.posthub.domain.model.IfMissingPolicy
import com.example.posthub.domain.model.TemplateSelectionMode
import com.example.posthub.service.JammyForegroundService
import com.example.posthub.updater.AppUpdater
import com.example.posthub.updater.UpdateState
import com.example.posthub.updater.VersionInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateToLog: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val container = JammyApp.instance.container
    val secureStore = container.secureStore
    val db = container.database

    val fieldDefs by db.fieldDefDao().getFieldDefsForWorkspaceFlow(1L).collectAsState(initial = emptyList())
    val templates by db.templateDao().getTemplatesForWorkspaceFlow(1L).collectAsState(initial = emptyList())

    var maxPostsPerDay by remember { mutableFloatStateOf(secureStore.getMaxPostsPerDay().toFloat()) }
    var maxJoinsPerDay by remember { mutableFloatStateOf(secureStore.getMaxJoinsPerDay().toFloat()) }
    var isDryRun by remember { mutableStateOf(secureStore.isDryRun()) }
    var isBiometric by remember { mutableStateOf(secureStore.isBiometricEnabled()) }
    var mergeWindowSec by remember { mutableFloatStateOf(secureStore.getMergeWindowSeconds().toFloat()) }

    var geminiApiKey by remember { mutableStateOf(secureStore.getGeminiApiKey()) }
    var isApiKeyVisible by remember { mutableStateOf(false) }
    var aiPromptTemplate by remember { mutableStateOf(secureStore.getAiPromptTemplate()) }
    var isAiAutoRewrite by remember { mutableStateOf(secureStore.isAiAutoRewriteEnabled()) }
    var monitoredZaloGroups by remember { mutableStateOf(secureStore.getMonitoredZaloGroups().toList()) }

    var isTestingAi by remember { mutableStateOf(false) }
    var testAiResultDialog by remember { mutableStateOf<String?>(null) }

    var updateState by remember { mutableStateOf<UpdateState>(UpdateState.Idle) }
    var versionInfo by remember { mutableStateOf<VersionInfo?>(null) }
    var isCheckingVersion by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        if (versionInfo == null) {
            isCheckingVersion = true
            versionInfo = AppUpdater.checkLatestVersion(context)
            isCheckingVersion = false
        }
    }
    var isAutoCheckUpdates by remember { mutableStateOf(secureStore.isAutoCheckUpdatesEnabled()) }
    var postSignature by remember { mutableStateOf(secureStore.getPostSignature()) }
    var autoCleanupDays by remember { mutableFloatStateOf(secureStore.getAutoCleanupDays().toFloat()) }
    var groupScanLookbackDays by remember { mutableFloatStateOf(secureStore.getGroupScanLookbackDays().toFloat()) }
    var isAutoGroupScan by remember { mutableStateOf(secureStore.isAutoGroupScanEnabled()) }
    var autoGroupScanInterval by remember { mutableFloatStateOf(secureStore.getAutoGroupScanIntervalMin().toFloat()) }

    var showAddFieldDialog by remember { mutableStateOf(false) }
    var showAddTemplateDialog by remember { mutableStateOf(false) }
    var showImportExportDialog by remember { mutableStateOf(false) }
    var showAddZaloGroupDialog by remember { mutableStateOf(false) }
    var newZaloGroupName by remember { mutableStateOf("") }
    var isViewingGeminiWebSettings by rememberSaveable { mutableStateOf(false) }

    if (isViewingGeminiWebSettings) {
        GeminiWebScreen(onBack = { isViewingGeminiWebSettings = false })
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Nút mở nhanh Nhật ký
        ElevatedCard(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.elevatedCardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer
            )
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Nhật ký hệ thống (AppLog)",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Text(
                        text = "Xem log Zalo, Facebook, sao chép hoặc chia sẻ",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
                Button(onClick = onNavigateToLog) {
                    Icon(Icons.Default.ReceiptLong, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Mở Log")
                }
            }
        }

        // Hướng dẫn quyền Zalo & Android 13+
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Notifications, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Cấp quyền bắt thông báo Zalo",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFFFF3E0), RoundedCornerShape(8.dp))
                        .padding(10.dp)
                ) {
                    Column {
                        Text(
                            text = "💡 Lưu ý cực kỳ quan trọng trên Android 13 & 14:",
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp,
                            color = Color(0xFFE65100)
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Nếu hệ điều hành báo 'Cài đặt bị hạn chế' khi bật quyền:\n" +
                                   "1. Bấm 'Mở Thông tin ứng dụng' bên dưới.\n" +
                                   "2. Bấm dấu 3 chấm góc phải trên màn hình.\n" +
                                   "3. Chọn 'Cho phép cài đặt bị hạn chế' (Allow restricted settings).\n" +
                                   "4. Quay lại đây và bấm 'Bật quyền đọc thông báo'.",
                            fontSize = 12.sp,
                            color = Color(0xFF5D4037)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                            context.startActivity(intent)
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Bật quyền thông báo", fontSize = 12.sp)
                    }

                    OutlinedButton(
                        onClick = {
                            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                data = Uri.fromParts("package", context.packageName, null)
                            }
                            context.startActivity(intent)
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Mở App Info (3 chấm)", fontSize = 12.sp)
                    }
                }
            }
        }

        // Quản lý Nhóm Zalo Đang Theo Dõi
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Chat, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Nhóm Zalo theo dõi (${monitoredZaloGroups.size})",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(
                            onClick = {
                                newZaloGroupName = ""
                                showAddZaloGroupDialog = true
                            },
                            contentPadding = ButtonDefaults.TextButtonContentPadding,
                            modifier = Modifier.height(30.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(2.dp))
                            Text("Thêm nhóm", fontSize = 11.sp)
                        }

                        if (monitoredZaloGroups.isNotEmpty()) {
                            Spacer(modifier = Modifier.width(4.dp))
                            TextButton(
                                onClick = {
                                    secureStore.setMonitoredZaloGroups(emptySet())
                                    monitoredZaloGroups = emptyList()
                                    Toast.makeText(context, "Đã xóa toàn bộ nhóm theo dõi", Toast.LENGTH_SHORT).show()
                                },
                                contentPadding = ButtonDefaults.TextButtonContentPadding,
                                modifier = Modifier.height(30.dp)
                            ) {
                                Text("Xóa hết", fontSize = 11.sp, color = Color(0xFFD32F2F))
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Chỉ các nhóm trong danh sách này mới được app thu thập tin để tạo bài đăng:",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )

                Spacer(modifier = Modifier.height(8.dp))
                if (monitoredZaloGroups.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFFE8F5E9), RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    ) {
                        Text(
                            text = "💡 Chưa chọn nhóm nào (Mặc định app sẽ bắt tin từ TẤT CẢ nhóm Zalo gửi thông báo đến máy).\n\n👉 Bấm 'Thêm nhóm' ở góc trên để chỉ định lọc đúng nhóm bạn muốn, hoặc sang tab Zalo Web bấm 'Theo dõi nhóm này'.",
                            fontSize = 12.sp,
                            color = Color(0xFF1B5E20)
                        )
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        monitoredZaloGroups.forEach { groupName ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f), RoundedCornerShape(6.dp))
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.Group, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(text = groupName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                }
                                IconButton(
                                    onClick = {
                                        secureStore.removeMonitoredZaloGroup(groupName)
                                        monitoredZaloGroups = secureStore.getMonitoredZaloGroups().toList()
                                    },
                                    modifier = Modifier.size(24.dp)
                                ) {
                                    Icon(Icons.Default.Delete, contentDescription = "Xóa nhóm", tint = Color(0xFFD32F2F), modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
            }
        }

        // Cấu hình Trí tuệ nhân tạo (AI Gemini)
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = Color(0xFF673AB7))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Trợ lý AI Gemini (Viết lại bài đăng)",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Sử dụng Google Gemini API hoặc kết nối trực tiếp Gemini Web để viết lại bài theo phong cách riêng của bạn.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )

                Spacer(modifier = Modifier.height(10.dp))

                // Nút mở Gemini Web để đăng nhập và xem cuộc trò chuyện
                Button(
                    onClick = { isViewingGeminiWebSettings = true },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF673AB7)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Mở Gemini Web (Đăng nhập / Xem chat)", fontSize = 12.sp)
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Ô nhập Prompt
                Text("Prompt tùy chỉnh của bạn:", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    text = "💡 Bạn chỉ cần dán đoạn Prompt đã có sẵn. App sẽ tự động gửi kèm nội dung tin Zalo để AI chỉnh sửa đúng theo ý bạn.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = aiPromptTemplate,
                    onValueChange = {
                        aiPromptTemplate = it
                        secureStore.setAiPromptTemplate(it)
                    },
                    modifier = Modifier.fillMaxWidth().height(140.dp),
                    textStyle = MaterialTheme.typography.bodySmall
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(
                        onClick = {
                            aiPromptTemplate = SecureStore.DEFAULT_AI_PROMPT
                            secureStore.setAiPromptTemplate(SecureStore.DEFAULT_AI_PROMPT)
                            Toast.makeText(context, "Đã khôi phục Prompt mẫu mặc định", Toast.LENGTH_SHORT).show()
                        }
                    ) {
                        Text("Khôi phục mẫu chuẩn", fontSize = 11.sp)
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Ô nhập API Key (nếu muốn dùng API tự động)
                Text("Cấu hình API Key (để tự động chạy ngầm không cần mở web):", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = geminiApiKey,
                    onValueChange = {
                        geminiApiKey = it
                        secureStore.setGeminiApiKey(it)
                    },
                    label = { Text("Gemini API Key (Tùy chọn)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = if (isApiKeyVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { isApiKeyVisible = !isApiKeyVisible }) {
                            Icon(
                                imageVector = if (isApiKeyVisible) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                contentDescription = if (isApiKeyVisible) "Ẩn API Key" else "Hiện API Key"
                            )
                        }
                    }
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End
                ) {
                    TextButton(
                        onClick = {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://aistudio.google.com/app/apikey"))
                            context.startActivity(intent)
                        }
                    ) {
                        Icon(Icons.Default.OpenInNew, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Lấy API Key miễn phí (Google AI Studio)", fontSize = 11.sp)
                    }
                }

                Spacer(modifier = Modifier.height(6.dp))

                // Switch tự động viết lại
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Tự động viết lại bằng AI", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        Text("Khi có tin Zalo mới, AI sẽ tự động viết lại trước khi lưu bài", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                    }
                    Switch(
                        checked = isAiAutoRewrite,
                        onCheckedChange = {
                            isAiAutoRewrite = it
                            secureStore.setAiAutoRewriteEnabled(it)
                        }
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Nút kiểm tra kết nối AI
                OutlinedButton(
                    onClick = {
                        if (geminiApiKey.isBlank()) {
                            Toast.makeText(context, "Vui lòng nhập API Key trước!", Toast.LENGTH_SHORT).show()
                            return@OutlinedButton
                        }
                        isTestingAi = true
                        scope.launch {
                            val aiService = container.aiService
                            val res = aiService.testConnection(geminiApiKey, aiPromptTemplate)
                            isTestingAi = false
                            res.onSuccess { output ->
                                testAiResultDialog = output
                            }.onFailure { err ->
                                testAiResultDialog = "❌ Kiểm tra thất bại:\n${err.message}"
                            }
                        }
                    },
                    enabled = !isTestingAi,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (isTestingAi) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Đang kiểm tra kết nối AI...", fontSize = 12.sp)
                    } else {
                        Icon(Icons.Default.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Kiểm tra kết nối AI (Test thử nghiệm)", fontSize = 12.sp)
                    }
                }
            }
        }

        // Chữ Ký Bài Viết & Tự Động Dọn Dẹp
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Edit, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Chữ Ký Bài Viết & Tự Động Dọn Dẹp",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Ô nhập chữ ký
                Text(
                    text = "Chữ ký bài đăng cố định (Hotline / Zalo / Chân bài viết)",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "Tự động chèn thông tin liên hệ này ở cuối mọi bài viết đã duyệt hoặc sau khi AI viết lại",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Spacer(modifier = Modifier.height(6.dp))
                OutlinedTextField(
                    value = postSignature,
                    onValueChange = {
                        postSignature = it
                        secureStore.setPostSignature(it)
                    },
                    placeholder = { Text("VD: 📞 Hotline/Zalo: 09xx.xxx.xxx - Hỗ trợ xem nhà 24/7", fontSize = 12.sp) },
                    modifier = Modifier.fillMaxWidth().height(80.dp),
                    textStyle = MaterialTheme.typography.bodySmall
                )

                Spacer(modifier = Modifier.height(12.dp))

                // Slider tự động dọn dẹp bài đã đăng
                Text(
                    text = "Tự động dọn dẹp bài đã đăng: ${autoCleanupDays.toInt()} ngày",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "Tự động xóa các bài 'Đã đăng' cũ hơn ${autoCleanupDays.toInt()} ngày khỏi app để nhẹ máy",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Slider(
                    value = autoCleanupDays,
                    onValueChange = {
                        autoCleanupDays = it
                        secureStore.setAutoCleanupDays(it.toInt())
                    },
                    valueRange = 1f..30f,
                    steps = 29
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Slider lookback quét nhóm
                Text(
                    text = "Thời gian quét nhóm FB: ${groupScanLookbackDays.toInt()} ngày",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "Quét nhóm đã tham gia và hoạt động trong vòng ${groupScanLookbackDays.toInt()} ngày trở lại",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )
                Slider(
                    value = groupScanLookbackDays,
                    onValueChange = {
                        groupScanLookbackDays = it
                        secureStore.setGroupScanLookbackDays(it.toInt())
                    },
                    valueRange = 7f..90f,
                    steps = 82
                )
            }
        }

        // Tự Động Quét Nhóm Facebook (Liên Tục)
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Default.Groups, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text(
                                text = "Tự Động Quét Nhóm FB Liên Tục",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "Tự động đồng bộ nhóm đã tham gia chạy ngầm, không cần bấm thủ công",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    }
                    Switch(
                        checked = isAutoGroupScan,
                        onCheckedChange = {
                            isAutoGroupScan = it
                            secureStore.setAutoGroupScanEnabled(it)
                            Toast.makeText(
                                context,
                                if (it) "Đã bật tự động quét nhóm FB ngầm" else "Đã tắt tự động quét nhóm FB ngầm",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    )
                }

                if (isAutoGroupScan) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "Chu kỳ quét tự động: ${autoGroupScanInterval.toInt()} phút/lần",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Dịch vụ ngầm sẽ tự động cập nhật danh sách nhóm Facebook mới định kỳ",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline
                    )
                    Slider(
                        value = autoGroupScanInterval,
                        onValueChange = {
                            autoGroupScanInterval = it
                            secureStore.setAutoGroupScanIntervalMin(it.toInt())
                        },
                        valueRange = 15f..120f,
                        steps = 6
                    )
                }
            }
        }

        // Quản lý Mẫu & Biến
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Quản lý Mẫu & Biến trích xuất",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    IconButton(onClick = { showImportExportDialog = true }) {
                        Icon(Icons.Default.Upload, contentDescription = "Xuất/Nhập JSON")
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
                Text(text = "Đang có: ${fieldDefs.size} biến tùy biến • ${templates.size} mẫu tin", style = MaterialTheme.typography.bodySmall)

                Spacer(modifier = Modifier.height(10.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { showAddFieldDialog = true },
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Thêm biến", fontSize = 12.sp)
                    }
                    OutlinedButton(
                        onClick = { showAddTemplateDialog = true },
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Thêm mẫu", fontSize = 12.sp)
                    }
                }
            }
        }

        // Rào chắn an toàn Facebook & Giới hạn
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Security, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Rào chắn an toàn tài khoản Facebook",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Giới hạn bài đăng/ngày
                Text("Giới hạn số bài đăng: ${maxPostsPerDay.toInt()} bài/ngày", style = MaterialTheme.typography.bodyMedium)
                Slider(
                    value = maxPostsPerDay,
                    onValueChange = {
                        maxPostsPerDay = it
                        secureStore.setMaxPostsPerDay(it.toInt())
                    },
                    valueRange = 1f..30f,
                    steps = 28
                )

                // Cửa sổ gộp tin Zalo
                Text("Cửa sổ thời gian gộp tin Zalo: ${mergeWindowSec.toInt()} giây", style = MaterialTheme.typography.bodyMedium)
                Slider(
                    value = mergeWindowSec,
                    onValueChange = {
                        mergeWindowSec = it
                        secureStore.setMergeWindowSeconds(it.toInt())
                    },
                    valueRange = 10f..60f,
                    steps = 9
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Dry Run Switch
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Chế độ thử nghiệm (Dry-Run)", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        Text("Chạy quy trình nhưng không bấm Đăng thật lên Facebook", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                    }
                    Switch(
                        checked = isDryRun,
                        onCheckedChange = {
                            isDryRun = it
                            secureStore.setDryRun(it)
                        }
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Khóa vân tay
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Khóa ứng dụng bằng sinh trắc học", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        Text("Yêu cầu vân tay / khuôn mặt khi mở app", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                    }
                    Switch(
                        checked = isBiometric,
                        onCheckedChange = {
                            isBiometric = it
                            secureStore.setBiometricEnabled(it)
                        }
                    )
                }
            }
        }

        // Tự Động Cập Nhật Trực Tiếp Trong Ứng Dụng (In-App Auto Update)
        ElevatedCard(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.elevatedCardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f)
            )
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.SystemUpdate,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Tự động cập nhật (In-App Auto Update)",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Tải và cài đè trực tiếp 1-chạm ngay trong app mà không cần mở trình duyệt và tuyệt đối không bao giờ cần xóa app!",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )

                Spacer(modifier = Modifier.height(6.dp))

                // Thông tin phiên bản chi tiết
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        val installedBuild = versionInfo?.currentBuildNumber ?: AppUpdater.getInstalledBuildNumber(context)
                        Text(
                            text = "📱 Phiên bản trên máy: Build #$installedBuild",
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp
                        )
                        val remoteText = when {
                            isCheckingVersion -> "Đang kiểm tra máy chủ..."
                            versionInfo?.remoteBuildNumber != null -> "Build #${versionInfo?.remoteBuildNumber}"
                            else -> "Chưa rõ (bấm làm mới)"
                        }
                        Text(
                            text = "☁️ Bản mới nhất trên server: $remoteText",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.outline
                        )
                    }

                    IconButton(
                        onClick = {
                            scope.launch {
                                isCheckingVersion = true
                                versionInfo = AppUpdater.checkLatestVersion(context)
                                isCheckingVersion = false
                            }
                        }
                    ) {
                        if (isCheckingVersion) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Refresh, contentDescription = "Kiểm tra bản mới")
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Bảng trạng thái phiên bản
                if (versionInfo != null) {
                    if (versionInfo!!.hasUpdate) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFFFFF3E0), RoundedCornerShape(8.dp))
                                .padding(10.dp)
                        ) {
                            Column {
                                Text(
                                    text = "⚡ ĐÃ CÓ BẢN MỚI: ${versionInfo?.releaseName}",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 12.sp,
                                    color = Color(0xFFE65100)
                                )
                                Text(
                                    text = "Máy bạn đang ở Build #${versionInfo?.currentBuildNumber}. Bạn hãy bấm nút bên dưới để nâng cấp đè trực tiếp.",
                                    fontSize = 11.sp,
                                    color = Color(0xFF5D4037)
                                )
                            }
                        }
                    } else if (versionInfo!!.remoteBuildNumber != null) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFFE8F5E9), RoundedCornerShape(8.dp))
                                .padding(10.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF2E7D32), modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(8.dp))
                                Column {
                                    Text(
                                        text = "✅ BẠN ĐANG DÙNG BẢN MỚI NHẤT (Build #${versionInfo?.currentBuildNumber})",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 12.sp,
                                        color = Color(0xFF2E7D32)
                                    )
                                    Text(
                                        text = "Ứng dụng đã được cập nhật đầy đủ, không cần cài đặt lại.",
                                        fontSize = 11.sp,
                                        color = Color(0xFF1B5E20)
                                    )
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                }

                // Trạng thái tiến trình tải / Hành động cập nhật
                when (val state = updateState) {
                    is UpdateState.Idle -> {
                        if (versionInfo?.hasUpdate == true) {
                            Button(
                                onClick = {
                                    scope.launch {
                                        AppUpdater.downloadAndInstall(context) { s ->
                                            updateState = s
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                            ) {
                                Icon(Icons.Default.Download, contentDescription = null)
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("🚀 Tải & Nâng Cấp Lên ${versionInfo?.releaseName}")
                            }
                        } else {
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(
                                    onClick = {
                                        scope.launch {
                                            isCheckingVersion = true
                                            versionInfo = AppUpdater.checkLatestVersion(context)
                                            isCheckingVersion = false
                                        }
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Kiểm tra bản mới", fontSize = 12.sp)
                                }

                                OutlinedButton(
                                    onClick = {
                                        scope.launch {
                                            AppUpdater.downloadAndInstall(context) { s ->
                                                updateState = s
                                            }
                                        }
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Cài đè lại APK", fontSize = 12.sp)
                                }
                            }
                        }
                    }
                    is UpdateState.Downloading -> {
                        Column(modifier = Modifier.fillMaxWidth()) {
                            if (state.totalBytes > 0) {
                                LinearProgressIndicator(
                                    progress = { state.progress },
                                    modifier = Modifier.fillMaxWidth().height(8.dp),
                                )
                                Spacer(modifier = Modifier.height(6.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "Đang tải: ${(state.progress * 100).toInt()}%",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                    val mbDownloaded = state.downloadedBytes / (1024f * 1024f)
                                    val mbTotal = state.totalBytes / (1024f * 1024f)
                                    Text(
                                        text = String.format("%.1f / %.1f MB", mbDownloaded, mbTotal),
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.outline
                                    )
                                }
                            } else {
                                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = "Đang tải bản cập nhật...",
                                    fontSize = 12.sp,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                    is UpdateState.ReadyToInstall -> {
                        Column(modifier = Modifier.fillMaxWidth()) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF2E7D32), modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "Đã tải xong! Đang mở bảng cài đặt hệ thống...",
                                    fontSize = 12.sp,
                                    color = Color(0xFF2E7D32),
                                    fontWeight = FontWeight.Bold
                                )
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "💡 Nếu máy yêu cầu 'Cho phép cài đặt từ nguồn này', hãy gạt Cho phép để cập nhật đè ngay.",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.outline
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Button(
                                onClick = {
                                    val apkFile = java.io.File(context.cacheDir, "updates/jammy_update.apk")
                                    AppUpdater.installApk(context, apkFile)
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Mở lại bảng cài đặt APK")
                            }
                        }
                    }
                    is UpdateState.Error -> {
                        Column(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                text = "❌ ${state.message}",
                                fontSize = 12.sp,
                                color = Color(0xFFD32F2F)
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Button(
                                onClick = {
                                    scope.launch {
                                        AppUpdater.downloadAndInstall(context) { s ->
                                            updateState = s
                                        }
                                    }
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Thử lại")
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Switch tự động kiểm tra khi mở app
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Tự động kiểm tra khi mở app", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        Text("Nhắc nhở cập nhật mỗi khi khởi động nếu có bản mới", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                    }
                    Switch(
                        checked = isAutoCheckUpdates,
                        onCheckedChange = {
                            isAutoCheckUpdates = it
                            secureStore.setAutoCheckUpdatesEnabled(it)
                        }
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Nút fallback mở GitHub Releases trên web
                OutlinedButton(
                    onClick = {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/hoangbao-code/tool-fb-automation/releases"))
                        context.startActivity(intent)
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Mở trang GitHub Releases trên trình duyệt", fontSize = 11.sp)
                }
            }
        }
    }

    // Dialog thêm FieldDef mới
    if (showAddFieldDialog) {
        var keyInput by remember { mutableStateOf("") }
        var nameInput by remember { mutableStateOf("") }
        var regexInput by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showAddFieldDialog = false },
            title = { Text("Thêm biến trích xuất mới") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = keyInput,
                        onValueChange = { keyInput = it },
                        label = { Text("Tên biến (viết liền, e.g. gia, quan)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = nameInput,
                        onValueChange = { nameInput = it },
                        label = { Text("Tên hiển thị (e.g. Giá thuê)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = regexInput,
                        onValueChange = { regexInput = it },
                        label = { Text("Biểu thức Regex (tùy chọn)") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (keyInput.isNotBlank()) {
                            scope.launch(Dispatchers.IO) {
                                db.fieldDefDao().insertFieldDef(
                                    FieldDefEntity(
                                        workspaceId = 1L,
                                        key = keyInput.trim().lowercase(),
                                        displayName = nameInput.trim(),
                                        extractRegex = regexInput.takeIf { it.isNotBlank() },
                                        ifMissing = IfMissingPolicy.SKIP_LINE
                                    )
                                )
                                withContext(Dispatchers.Main) {
                                    showAddFieldDialog = false
                                    Toast.makeText(context, "Đã thêm biến {${keyInput.trim().lowercase()}}!", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                ) {
                    Text("Lưu biến")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddFieldDialog = false }) { Text("Hủy") }
            }
        )
    }

    // Dialog thêm Template mới
    if (showAddTemplateDialog) {
        var titleInput by remember { mutableStateOf("") }
        var contentInput by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showAddTemplateDialog = false },
            title = { Text("Tạo mẫu tin (Template) mới") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = titleInput,
                        onValueChange = { titleInput = it },
                        label = { Text("Tiêu đề mẫu (e.g. Mẫu phòng trọ giá rẻ)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = contentInput,
                        onValueChange = { contentInput = it },
                        label = { Text("Nội dung mẫu (chèn {gia}, {quan}...)") },
                        modifier = Modifier.fillMaxWidth().height(160.dp)
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (titleInput.isNotBlank() && contentInput.isNotBlank()) {
                            scope.launch(Dispatchers.IO) {
                                db.templateDao().insertTemplate(
                                    TemplateEntity(
                                        workspaceId = 1L,
                                        title = titleInput.trim(),
                                        content = contentInput.trim(),
                                        selectionMode = TemplateSelectionMode.MANUAL
                                    )
                                )
                                withContext(Dispatchers.Main) {
                                    showAddTemplateDialog = false
                                    Toast.makeText(context, "Đã tạo mẫu tin mới!", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    }
                ) {
                    Text("Lưu mẫu")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddTemplateDialog = false }) { Text("Hủy") }
            }
        )
    }

    // Dialog Xuất / Nhập cấu hình JSON
    if (showImportExportDialog) {
        var jsonText by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showImportExportDialog = false },
            title = { Text("Xuất / Nhập cấu hình JSON") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Sao chép cấu hình hiện tại để lưu trữ hoặc dán JSON vào để nhập mẫu nhanh:",
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedTextField(
                        value = jsonText,
                        onValueChange = { jsonText = it },
                        label = { Text("Dữ liệu JSON") },
                        modifier = Modifier.fillMaxWidth().height(140.dp)
                    )
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = {
                                scope.launch(Dispatchers.IO) {
                                    val rootObj = JSONObject()
                                    val tmplArray = JSONArray()
                                    templates.forEach {
                                        tmplArray.put(JSONObject().apply {
                                            put("title", it.title)
                                            put("content", it.content)
                                        })
                                    }
                                    rootObj.put("templates", tmplArray)
                                    val exportedStr = rootObj.toString(2)
                                    withContext(Dispatchers.Main) {
                                        jsonText = exportedStr
                                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                        clipboard.setPrimaryClip(ClipData.newPlainText("jammy_config", exportedStr))
                                        Toast.makeText(context, "Đã xuất và sao chép JSON vào Clipboard!", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Xuất JSON", fontSize = 12.sp)
                        }

                        Button(
                            onClick = {
                                if (jsonText.isNotBlank()) {
                                    scope.launch(Dispatchers.IO) {
                                        try {
                                            val rootObj = JSONObject(jsonText)
                                            val tmplArray = rootObj.optJSONArray("templates") ?: JSONArray()
                                            for (i in 0 until tmplArray.length()) {
                                                val item = tmplArray.getJSONObject(i)
                                                db.templateDao().insertTemplate(
                                                    TemplateEntity(
                                                        workspaceId = 1L,
                                                        title = item.getString("title"),
                                                        content = item.getString("content")
                                                    )
                                                )
                                            }
                                            withContext(Dispatchers.Main) {
                                                showImportExportDialog = false
                                                Toast.makeText(context, "Đã nhập cấu hình thành công!", Toast.LENGTH_SHORT).show()
                                            }
                                        } catch (e: Exception) {
                                            withContext(Dispatchers.Main) {
                                                Toast.makeText(context, "Lỗi cú pháp JSON: ${e.message}", Toast.LENGTH_LONG).show()
                                            }
                                        }
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Nhập JSON", fontSize = 12.sp)
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showImportExportDialog = false }) { Text("Đóng") }
            }
        )
    }

    // Dialog kết quả kiểm tra kết nối AI Gemini
    if (testAiResultDialog != null) {
        AlertDialog(
            onDismissRequest = { testAiResultDialog = null },
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = Color(0xFF673AB7))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Kết quả thử nghiệm AI")
                }
            },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                ) {
                    Text(
                        text = testAiResultDialog!!,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            },
            confirmButton = {
                Button(onClick = { testAiResultDialog = null }) {
                    Text("Đóng")
                }
            }
        )
    }

    // Dialog thêm nhóm Zalo thủ công
    if (showAddZaloGroupDialog) {
        AlertDialog(
            onDismissRequest = { showAddZaloGroupDialog = false },
            title = { Text("Thêm nhóm Zalo cần theo dõi") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Nhập chính xác tên nhóm Zalo bạn muốn app tự động lấy tin nhắn (hoặc một phần tên nhóm):",
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedTextField(
                        value = newZaloGroupName,
                        onValueChange = { newZaloGroupName = it },
                        label = { Text("Tên nhóm Zalo") },
                        placeholder = { Text("Ví dụ: Bất Động Sản Hà Nội...") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val name = newZaloGroupName.trim()
                        if (name.isNotBlank()) {
                            secureStore.addMonitoredZaloGroup(name)
                            monitoredZaloGroups = secureStore.getMonitoredZaloGroups().toList()
                            Toast.makeText(context, "Đã thêm nhóm theo dõi: $name", Toast.LENGTH_SHORT).show()
                        }
                        showAddZaloGroupDialog = false
                    },
                    enabled = newZaloGroupName.isNotBlank()
                ) {
                    Text("Lưu nhóm")
                }
            },
            dismissButton = {
                TextButton(onClick = { showAddZaloGroupDialog = false }) {
                    Text("Hủy")
                }
            }
        )
    }
}
