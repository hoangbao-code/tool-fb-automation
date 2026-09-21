package com.example.posthub.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.posthub.data.AppLog
import com.example.posthub.data.LogEntry
import com.example.posthub.data.LogLevel
import com.example.posthub.ui.theme.LogDebugColor
import com.example.posthub.ui.theme.LogErrorColor
import com.example.posthub.ui.theme.LogInfoColor
import com.example.posthub.ui.theme.LogWarnColor
import kotlinx.coroutines.launch

@Composable
fun LogScreen(
    onBack: (() -> Unit)? = null
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    val logEntries = remember { mutableStateListOf<LogEntry>().apply { addAll(AppLog.getRecentLogs()) } }
    var selectedLevel by remember { mutableStateOf<LogLevel?>(null) }
    var autoScroll by remember { mutableStateOf(true) }

    // Thu thập log phát ra từ SharedFlow
    val newLogFlow = AppLog.logFlow.collectAsState(initial = null)
    LaunchedEffect(newLogFlow.value) {
        val entry = newLogFlow.value
        if (entry != null && !logEntries.contains(entry)) {
            logEntries.add(entry)
            if (autoScroll && logEntries.isNotEmpty()) {
                listState.animateScrollToItem(logEntries.size - 1)
            }
        }
    }

    val filteredLogs = remember(logEntries, selectedLevel) {
        if (selectedLevel == null) {
            logEntries.toList()
        } else {
            logEntries.filter { it.level == selectedLevel }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Thanh công cụ hành động
            Surface(
                modifier = Modifier.fillMaxWidth(),
                tonalElevation = 2.dp
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (onBack != null) {
                                IconButton(onClick = onBack) {
                                    Icon(Icons.Default.ArrowBack, contentDescription = "Quay lại")
                                }
                                Spacer(modifier = Modifier.width(4.dp))
                            }
                            Text(
                                text = "Nhật ký hoạt động (${filteredLogs.size})",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Row {
                            // Nút Sao chép
                            IconButton(
                                onClick = {
                                    val allText = AppLog.readAllLogsFromFile()
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    val clip = ClipData.newPlainText("Jammy_post_hub_logs", allText)
                                    clipboard.setPrimaryClip(clip)
                                    Toast.makeText(context, "Đã sao chép toàn bộ nhật ký vào Clipboard!", Toast.LENGTH_SHORT).show()
                                }
                            ) {
                                Icon(Icons.Default.ContentCopy, contentDescription = "Sao chép nhật ký")
                            }

                            // Nút Chia sẻ
                            IconButton(
                                onClick = {
                                    val allText = AppLog.readAllLogsFromFile()
                                    val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_SUBJECT, "Nhật ký Jammy_post_hub")
                                        putExtra(Intent.EXTRA_TEXT, allText)
                                    }
                                    context.startActivity(Intent.createChooser(shareIntent, "Chia sẻ nhật ký qua..."))
                                }
                            ) {
                                Icon(Icons.Default.Share, contentDescription = "Chia sẻ nhật ký")
                            }

                            // Nút Xóa log
                            IconButton(
                                onClick = {
                                    AppLog.clearLogs()
                                    logEntries.clear()
                                    Toast.makeText(context, "Đã xóa nhật ký", Toast.LENGTH_SHORT).show()
                                }
                            ) {
                                Icon(Icons.Default.Clear, contentDescription = "Xóa nhật ký")
                            }
                        }
                    }

                    // Bộ lọc cấp độ log
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        FilterChip(
                            selected = selectedLevel == null,
                            onClick = { selectedLevel = null },
                            label = { Text("Tất cả") }
                        )
                        FilterChip(
                            selected = selectedLevel == LogLevel.INFO,
                            onClick = { selectedLevel = if (selectedLevel == LogLevel.INFO) null else LogLevel.INFO },
                            label = { Text("INFO", color = LogInfoColor) }
                        )
                        FilterChip(
                            selected = selectedLevel == LogLevel.DEBUG,
                            onClick = { selectedLevel = if (selectedLevel == LogLevel.DEBUG) null else LogLevel.DEBUG },
                            label = { Text("DEBUG", color = LogDebugColor) }
                        )
                        FilterChip(
                            selected = selectedLevel == LogLevel.WARN,
                            onClick = { selectedLevel = if (selectedLevel == LogLevel.WARN) null else LogLevel.WARN },
                            label = { Text("WARN", color = LogWarnColor) }
                        )
                        FilterChip(
                            selected = selectedLevel == LogLevel.ERROR,
                            onClick = { selectedLevel = if (selectedLevel == LogLevel.ERROR) null else LogLevel.ERROR },
                            label = { Text("ERROR", color = LogErrorColor) }
                        )
                    }
                }
            }

            // Danh sách log
            if (filteredLogs.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "Chưa có dòng nhật ký nào phù hợp.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0xFF1E1E1E))
                        .padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    items(filteredLogs) { entry ->
                        LogItemView(entry)
                    }
                }
            }
        }

        // Nút cuộn xuống cuối màn hình
        FloatingActionButton(
            onClick = {
                scope.launch {
                    if (filteredLogs.isNotEmpty()) {
                        listState.animateScrollToItem(filteredLogs.size - 1)
                    }
                }
            },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
            containerColor = MaterialTheme.colorScheme.primaryContainer
        ) {
            Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Cuộn xuống cuối")
        }
    }
}

@Composable
private fun LogItemView(entry: LogEntry) {
    val levelColor = when (entry.level) {
        LogLevel.DEBUG -> LogDebugColor
        LogLevel.INFO -> LogInfoColor
        LogLevel.WARN -> LogWarnColor
        LogLevel.ERROR -> LogErrorColor
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color(0xFF2A2A2A), RoundedCornerShape(4.dp))
            .padding(8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "[${entry.level.name}]",
                    color = levelColor,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = entry.tag,
                    color = Color(0xFF81D4FA),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    fontFamily = FontFamily.Monospace
                )
            }
            Text(
                text = entry.format().substringBefore(" ["),
                color = Color.Gray,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace
            )
        }

        Spacer(modifier = Modifier.padding(vertical = 2.dp))

        Text(
            text = entry.message,
            color = Color(0xFFE0E0E0),
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace
        )

        if (entry.throwable != null) {
            Spacer(modifier = Modifier.padding(vertical = 2.dp))
            Text(
                text = entry.throwable.stackTraceToString(),
                color = LogErrorColor,
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace
            )
        }
    }
}
