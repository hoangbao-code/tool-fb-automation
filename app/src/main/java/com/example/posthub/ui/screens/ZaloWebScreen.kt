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
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.content.ContentValues
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Phone
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
import androidx.compose.material3.OutlinedTextField
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
    var showCookieDialog by remember { mutableStateOf(false) }
    var inputCookieText by remember { mutableStateOf(secureStore.getZaloCustomSek()) }

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

                // Hỗ trợ đăng nhập siêu tốc khi chưa đăng nhập hoặc chưa chọn hội thoại
                if (activeConversation.isBlank()) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = {
                                val wv = zaloSession.getOrCreateWebView(context)
                                wv.evaluateJavascript("""
                                    (function() {
                                        var tabs = document.querySelectorAll('.tab, [role="tab"], a, div, span');
                                        for (var i = 0; i < tabs.length; i++) {
                                            var t = tabs[i];
                                            if (t.innerText && (t.innerText.indexOf('VỚI SỐ ĐIỆN THOẠI') !== -1 || t.innerText.indexOf('Số điện thoại') !== -1)) {
                                                t.click();
                                                return 'clicked';
                                            }
                                        }
                                        return 'not_found';
                                    })();
                                """.trimIndent()) {
                                    Toast.makeText(context, "Đã chuyển sang tab Đăng nhập bằng SĐT & Mật khẩu (Không lo hết hạn QR)!", Toast.LENGTH_SHORT).show()
                                }
                            },
                            modifier = Modifier.weight(1f).height(36.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                        ) {
                            Icon(Icons.Default.Phone, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Đăng nhập SĐT", fontSize = 11.sp)
                        }

                        Button(
                            onClick = {
                                captureQrAndOpenZalo(context, zaloSession.getOrCreateWebView(context))
                            },
                            modifier = Modifier.weight(1.2f).height(36.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0088FF))
                        ) {
                            Icon(Icons.Default.CameraAlt, contentDescription = null, modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Chụp QR & Mở Zalo", fontSize = 11.sp)
                        }
                    }

                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = {
                                zaloSession.applyCustomSek(secureStore.getZaloCustomSek())
                                Toast.makeText(context, "🚀 Đang nạp Cookie sẵn có và vào Zalo Web...", Toast.LENGTH_SHORT).show()
                            },
                            modifier = Modifier.weight(1.3f).height(36.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E7D32))
                        ) {
                            Text("🚀 Đăng nhập Cookie sẵn", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }

                        OutlinedButton(
                            onClick = { showCookieDialog = true },
                            modifier = Modifier.weight(1f).height(36.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF0D47A1))
                        ) {
                            Icon(Icons.Default.Computer, contentDescription = null, modifier = Modifier.size(13.dp))
                            Spacer(modifier = Modifier.width(3.dp))
                            Text("Đổi Cookie", fontSize = 11.sp)
                        }
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
            title = { Text("Hướng dẫn Zalo Web & Đăng nhập nhanh") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "🚀 ĐĂNG NHẬP NHANH (TRÁNH HẾT HẠN QR 1P30S):",
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = "👉 Cách 1 (Khuyên dùng): Bấm nút [Đăng nhập SĐT]\nChuyển sang đăng nhập bằng SĐT & Mật khẩu. Không sợ mã QR bị đổi hoặc hết hạn 1p30s!",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        text = "👉 Cách 2: Bấm nút [Chụp QR & Mở Zalo]\nApp tự chụp mã QR lưu vào Thư viện và tự mở Zalo lên. Bạn chỉ cần vào Quét QR trong Zalo -> Chọn ảnh mới nhất -> Bấm Xác nhận (chỉ mất 5 giây)!",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        text = "👉 Cách 3: Ném Cookie/Session từ máy tính\nBấm nút [💻 Ném Cookie từ máy tính], copy kết quả từ máy tính dán vào là vào thẳng nick mà không cần quét QR hay gõ mật khẩu!",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "📌 CHỌN NHÓM CẦN LẤY TIN:",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = "- Bấm vào nhóm bạn muốn trong danh sách chat -> Nút 'Theo dõi nhóm này' sẽ hiện ra ở thanh trên.\n- Hoặc bấm nút 'Quét nhóm' ở góc trên để tích chọn hàng loạt.",
                        style = MaterialTheme.typography.bodySmall
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

    // Dialog nạp Cookie / Session từ máy tính vào Tool
    if (showCookieDialog) {
        AlertDialog(
            onDismissRequest = { showCookieDialog = false },
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Computer, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Ném Cookie Zalo từ Máy tính", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
            },
            text = {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "Cách lấy Cookie trên máy tính (3 bước):",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        text = "1. Mở trang chat.zalo.me trên máy tính (nơi bạn đã đăng nhập).\n" +
                               "2. Bấm F12 trên bàn phím -> Chọn tab 'Console' -> Gõ dòng này rồi ấn Enter:\n" +
                               "   document.cookie\n" +
                               "   (Hoặc gõ: localStorage.getItem('zpw_sek'))\n" +
                               "3. Copy toàn bộ kết quả hiện ra, gửi qua điện thoại rồi dán vào ô bên dưới:",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = inputCookieText,
                        onValueChange = { inputCookieText = it },
                        modifier = Modifier.fillMaxWidth().height(120.dp),
                        placeholder = { Text("Dán Cookie hoặc mã zpw_sek vào đây...", fontSize = 11.sp) },
                        maxLines = 5,
                        textStyle = MaterialTheme.typography.bodySmall
                    )
                    Text(
                        text = "⚠️ Lưu ý: Zalo chỉ cho phép 1 phiên Zalo Web hoạt động. Sau khi ném vào tool, Zalo Web trên máy tính sẽ tự đăng xuất.",
                        fontSize = 10.sp,
                        color = Color(0xFFD32F2F)
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        injectCookiesOrToken(context, zaloSession.getOrCreateWebView(context), secureStore, inputCookieText)
                        showCookieDialog = false
                    },
                    enabled = inputCookieText.isNotBlank()
                ) {
                    Text("Áp dụng & Đăng nhập")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCookieDialog = false }) {
                    Text("Đóng")
                }
            }
        )
    }
}

/**
 * Chụp nhanh màn hình QR từ WebView và mở ngay ứng dụng Zalo để quét trong 5 giây
 */
private fun captureQrAndOpenZalo(context: Context, webView: WebView) {
    try {
        if (webView.width <= 0 || webView.height <= 0) {
            Toast.makeText(context, "Trang Zalo Web chưa tải xong. Vui lòng đợi 2-3 giây!", Toast.LENGTH_SHORT).show()
            return
        }

        // 1. Tạo Bitmap từ WebView
        val bitmap = Bitmap.createBitmap(webView.width, webView.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        webView.draw(canvas)

        // 2. Lưu vào Thư viện ảnh (MediaStore) để ảnh xuất hiện ngay đầu tiên
        val filename = "Zalo_QR_${System.currentTimeMillis()}.jpg"
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, filename)
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Jammy")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }

        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)

        if (uri != null) {
            resolver.openOutputStream(uri)?.use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }

            // Thông báo MediaScanner cập nhật
            MediaScannerConnection.scanFile(
                context,
                arrayOf(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES).toString()),
                arrayOf("image/jpeg"),
                null
            )

            Toast.makeText(context, "📸 Đã chụp mã QR! Đang mở Zalo để bạn quét...", Toast.LENGTH_SHORT).show()

            // 3. Mở Zalo để người dùng quét ảnh
            val zaloIntent = context.packageManager.getLaunchIntentForPackage("com.zing.zalo")
            if (zaloIntent != null) {
                zaloIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(zaloIntent)
            } else {
                Toast.makeText(context, "Mã QR đã lưu trong Thư viện ảnh!", Toast.LENGTH_LONG).show()
            }
        } else {
            Toast.makeText(context, "Không thể lưu ảnh QR vào bộ nhớ thiết bị", Toast.LENGTH_SHORT).show()
        }
    } catch (e: Exception) {
        Toast.makeText(context, "Lỗi chụp QR: ${e.message}", Toast.LENGTH_SHORT).show()
    }
}

/**
 * Nạp Cookie hoặc Session Token (zpw_sek) từ máy tính vào WebView Zalo Web
 */
private fun injectCookiesOrToken(context: Context, webView: WebView, secureStore: com.example.posthub.data.local.SecureStore, rawInput: String) {
    try {
        val trimmed = rawInput.trim().trim('"', '\'')
        if (trimmed.isEmpty()) {
            Toast.makeText(context, "Vui lòng nhập Cookie hoặc mã zpw_sek!", Toast.LENGTH_SHORT).show()
            return
        }

        val cookieManager = android.webkit.CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        val domain = "https://chat.zalo.me"
        val cookieDomain = ".zalo.me"
        var extractedSek: String? = null

        when {
            // Định dạng JSON array (xuất từ Cookie-Editor extension)
            trimmed.startsWith("[") && trimmed.endsWith("]") -> {
                val jsonArray = org.json.JSONArray(trimmed)
                for (i in 0 until jsonArray.length()) {
                    val obj = jsonArray.getJSONObject(i)
                    val name = obj.optString("name")
                    val value = obj.optString("value")
                    val path = obj.optString("path", "/")
                    if (name.isNotEmpty()) {
                        cookieManager.setCookie(domain, "$name=$value; Domain=$cookieDomain; Path=$path; Secure")
                        if (name == "zpw_sek") extractedSek = value
                    }
                }
            }
            // Chuỗi Cookie tiêu chuẩn: "key1=val1; key2=val2"
            trimmed.contains("=") -> {
                val parts = trimmed.split(";")
                for (part in parts) {
                    val cookie = part.trim()
                    if (cookie.isNotEmpty()) {
                        cookieManager.setCookie(domain, "$cookie; Domain=$cookieDomain; Path=/; Secure")
                        if (cookie.startsWith("zpw_sek=")) {
                            extractedSek = cookie.substringAfter("zpw_sek=").trim()
                        }
                    }
                }
            }
            // Người dùng chỉ dán trực tiếp chuỗi token zpw_sek
            else -> {
                extractedSek = trimmed
                cookieManager.setCookie(domain, "zpw_sek=$trimmed; Domain=$cookieDomain; Path=/; Secure")
            }
        }

        cookieManager.flush()

        // Nạp thêm vào localStorage của chat.zalo.me để đồng bộ client-side và lưu vào SecureStore
        if (!extractedSek.isNullOrEmpty()) {
            secureStore.setZaloCustomSek(extractedSek)
            val sekSafe = extractedSek.replace("'", "\\'")
            webView.evaluateJavascript("""
                (function() {
                    try {
                        localStorage.setItem('zpw_sek', '$sekSafe');
                    } catch(e) {}
                })();
            """.trimIndent(), null)
        }

        // Tải lại trang chat.zalo.me
        webView.loadUrl(domain)
        Toast.makeText(context, "🎉 Đã nạp Cookie Zalo! Đang tải lại phiên đăng nhập...", Toast.LENGTH_LONG).show()
    } catch (e: Exception) {
        Toast.makeText(context, "Lỗi nạp Cookie: ${e.message}", Toast.LENGTH_SHORT).show()
    }
}
