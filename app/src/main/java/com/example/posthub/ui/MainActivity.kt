package com.example.posthub.ui

import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Article
import androidx.compose.material.icons.filled.Facebook
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
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
import com.example.posthub.ui.theme.JammyPostHubTheme
import androidx.fragment.app.FragmentActivity

sealed class MainTab(val index: Int, val title: String, val icon: ImageVector) {
    object Feed : MainTab(0, "Tin", Icons.Default.Article)
    object Groups : MainTab(1, "Nhóm", Icons.Default.Groups)
    object Facebook : MainTab(2, "Facebook", Icons.Default.Facebook)
    object Settings : MainTab(3, "Cài đặt", Icons.Default.Settings)
    object Log : MainTab(4, "Nhật ký", Icons.Default.ReceiptLong)
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
    var fbInitialUrl by remember { mutableStateOf<String?>(null) }

    val tabs = listOf(
        MainTab.Feed,
        MainTab.Groups,
        MainTab.Facebook,
        MainTab.Settings,
        MainTab.Log
    )

    // Nếu đang trong màn hình Duyệt bài chi tiết
    if (activeReviewPostId != null) {
        ReviewScreen(
            postId = activeReviewPostId!!,
            onBack = { activeReviewPostId = null }
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
                1 -> GroupScreen(
                    onOpenGroupInFb = { url ->
                        fbInitialUrl = url
                        selectedTabIndex = 2 // Chuyển sang tab Facebook
                    }
                )
                2 -> FacebookScreen(
                    initialUrl = fbInitialUrl
                )
                3 -> SettingsScreen(
                    onNavigateToLog = { selectedTabIndex = 4 }
                )
                4 -> LogScreen()
            }
        }
    }
}
