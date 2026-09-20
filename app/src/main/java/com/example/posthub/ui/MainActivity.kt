package com.example.posthub.ui

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Article
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Facebook
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.service.JammyForegroundService
import com.example.posthub.ui.screens.FacebookScreen
import com.example.posthub.ui.screens.FeedScreen
import com.example.posthub.ui.screens.GroupScreen
import com.example.posthub.ui.screens.LogScreen
import com.example.posthub.ui.screens.ReviewScreen
import com.example.posthub.ui.screens.SettingsScreen
import com.example.posthub.ui.screens.ZaloWebScreen
import com.example.posthub.ui.theme.JammyPostHubTheme
import com.example.posthub.updater.AppUpdater
import com.example.posthub.updater.UpdateState
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed class MainTab(val index: Int, val title: String, val icon: ImageVector) {
    object Feed : MainTab(0, "Tin", Icons.Default.Article)
    object Zalo : MainTab(1, "Zalo Web", Icons.Default.Chat)
    object Groups : MainTab(2, "Nhóm FB", Icons.Default.Groups)
    object Facebook : MainTab(3, "Facebook", Icons.Default.Facebook)
    object Settings : MainTab(4, "Cài đặt", Icons.Default.Settings)
}

class MainActivity : FragmentActivity() {

    private var isUnlocked by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val secureStore = JammyApp.instance.container.secureStore
        if (secureStore.isBiometricEnabled()) {
            authenticateWithBiometrics()
        } else {
            isUnlocked = true
        }

        // Tự động khởi động ForegroundService để giữ kết nối Zalo
        try {
            JammyForegroundService.start(this)
        } catch (e: Exception) {
            AppLog.w("MainActivity", "Không thể tự khởi động JammyForegroundService: ${e.message}")
        }

        // Tự động quét và đồng bộ nhóm Facebook ngầm khi khởi động ứng dụng
        lifecycleScope.launch(Dispatchers.IO) {
            delay(5000L)
            try {
                JammyApp.instance.container.syncJoinedGroupsSilently()
            } catch (e: Exception) {
                AppLog.e("MainActivity", "Lỗi tự động đồng bộ nhóm FB khi khởi động: ${e.message}")
            }
        }

        val navigatePostId = intent.getLongExtra("EXTRA_NAVIGATE_POST_ID", -1L).takeIf { it != -1L }

        setContent {
            JammyPostHubTheme {
                if (isUnlocked) {
                    MainAppLayout(initialReviewPostId = navigatePostId)
                } else {
                    Box(modifier = Modifier.fillMaxSize())
                }
            }
        }
    }

    private fun authenticateWithBiometrics() {
        val executor = ContextCompat.getMainExecutor(this)
        val biometricPrompt = BiometricPrompt(this, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                super.onAuthenticationSucceeded(result)
                isUnlocked = true
                AppLog.i("MainActivity", "Xác thực sinh trắc học thành công.")
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                super.onAuthenticationError(errorCode, errString)
                Toast.makeText(this@MainActivity, "Xác thực thất bại: $errString", Toast.LENGTH_SHORT).show()
                finish()
            }
        })

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Jammy_post_hub")
            .setSubtitle("Xác thực vân tay để mở ứng dụng")
            .setNegativeButtonText("Thoát")
            .build()

        biometricPrompt.authenticate(promptInfo)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainAppLayout(
    initialReviewPostId: Long? = null
) {
    var selectedTabIndex by rememberSaveable { mutableIntStateOf(0) }
    var activeReviewPostId by rememberSaveable { mutableStateOf(initialReviewPostId) }
    var isViewingLog by rememberSaveable { mutableStateOf(false) }
    var fbInitialUrl by remember { mutableStateOf<String?>(null) }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val container = JammyApp.instance.container
    var showStartupUpdateDialog by remember { mutableStateOf(false) }
    var startupUpdateState by remember { mutableStateOf<UpdateState>(UpdateState.Idle) }

    // Tự động kiểm tra bản cập nhật mới khi mở app
    LaunchedEffect(Unit) {
        if (container.secureStore.isAutoCheckUpdatesEnabled()) {
            withContext(Dispatchers.IO) {
                try {
                    val conn = java.net.URL(AppUpdater.NIGHTLY_APK_URL).openConnection() as java.net.HttpURLConnection
                    conn.requestMethod = "HEAD"
                    conn.connectTimeout = 4000
                    conn.readTimeout = 4000
                    conn.instanceFollowRedirects = true
                    val code = conn.responseCode
                    if (code in 200..399) {
                        withContext(Dispatchers.Main) {
                            showStartupUpdateDialog = true
                        }
                    }
                    conn.disconnect()
                } catch (e: Exception) {
                    // Chạy ngầm, không làm phiền người dùng nếu mất mạng
                }
            }
        }
    }

    val tabs = listOf(
        MainTab.Feed,
        MainTab.Zalo,
        MainTab.Groups,
        MainTab.Facebook,
        MainTab.Settings
    )

    // Hộp thoại cập nhật khi mở app
    if (showStartupUpdateDialog) {
        AlertDialog(
            onDismissRequest = {
                if (startupUpdateState !is UpdateState.Downloading) {
                    showStartupUpdateDialog = false
                }
            },
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Download, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Bản Cập Nhật Mới", fontWeight = FontWeight.Bold)
                }
            },
            text = {
                Column {
                    Text("Đã có bản cập nhật mới nhất cho Jammy_post_hub. Bạn có muốn tải và cài đè trực tiếp ngay không?")
                    Spacer(modifier = Modifier.height(10.dp))
                    when (val s = startupUpdateState) {
                        is UpdateState.Downloading -> {
                            if (s.totalBytes > 0) {
                                LinearProgressIndicator(progress = { s.progress }, modifier = Modifier.fillMaxWidth())
                                Spacer(modifier = Modifier.height(4.dp))
                                Text("Đang tải: ${(s.progress * 100).toInt()}%", fontSize = 11.sp)
                            } else {
                                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                                Spacer(modifier = Modifier.height(4.dp))
                                Text("Đang tải bản cập nhật...", fontSize = 11.sp)
                            }
                        }
                        is UpdateState.ReadyToInstall -> {
                            Text("Đã tải xong! Đang mở hộp thoại cài đặt...", color = Color(0xFF2E7D32), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        }
                        is UpdateState.Error -> {
                            Text("Lỗi tải: ${s.message}", color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                        }
                        else -> {}
                    }
                }
            },
            confirmButton = {
                if (startupUpdateState !is UpdateState.Downloading) {
                    Button(
                        onClick = {
                            scope.launch {
                                AppUpdater.downloadAndInstall(context) { s ->
                                    startupUpdateState = s
                                }
                            }
                        }
                    ) {
                        Text("Cập nhật ngay")
                    }
                }
            },
            dismissButton = {
                if (startupUpdateState !is UpdateState.Downloading) {
                    TextButton(onClick = { showStartupUpdateDialog = false }) {
                        Text("Để sau")
                    }
                }
            }
        )
    }

    // Nếu đang mở trang Nhật ký
    if (isViewingLog) {
        LogScreen(onBack = { isViewingLog = false })
        return
    }

    // Nếu đang trong màn hình Duyệt bài chi tiết
    if (activeReviewPostId != null) {
        ReviewScreen(
            postId = activeReviewPostId!!,
            onBack = { activeReviewPostId = null },
            onOpenInFacebook = { groupUrl ->
                activeReviewPostId = null
                fbInitialUrl = groupUrl
                selectedTabIndex = 3 // Chuyển sang Tab Facebook
            }
        )
        return
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Jammy_post_hub",
                        fontWeight = FontWeight.Bold
                    )
                },
                actions = {
                    IconButton(onClick = { isViewingLog = true }) {
                        Icon(
                            imageVector = Icons.Default.ReceiptLong,
                            contentDescription = "Mở nhật ký hệ thống"
                        )
                    }
                    Badge(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                    ) {
                        Text(text = "PRO")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTabIndex == tab.index,
                        onClick = { selectedTabIndex = tab.index },
                        icon = {
                            Icon(imageVector = tab.icon, contentDescription = tab.title)
                        },
                        label = {
                            Text(text = tab.title)
                        }
                    )
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (selectedTabIndex) {
                0 -> FeedScreen(
                    onOpenPostReview = { postId -> activeReviewPostId = postId }
                )
                1 -> ZaloWebScreen()
                2 -> GroupScreen(
                    onOpenGroupInFb = { url ->
                        fbInitialUrl = url
                        selectedTabIndex = 3 // Chuyển sang tab Facebook
                    }
                )
                3 -> FacebookScreen(
                    initialUrl = fbInitialUrl
                )
                4 -> SettingsScreen(
                    onNavigateToLog = { isViewingLog = true }
                )
            }
        }
    }
}
