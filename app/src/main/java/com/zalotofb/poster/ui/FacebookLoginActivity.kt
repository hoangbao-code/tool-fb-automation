package com.zalotofb.poster.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.zalotofb.poster.R
import com.zalotofb.poster.facebook.FacebookSessionManager

class FacebookLoginActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var sessionManager: FacebookSessionManager

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_facebook_login)

        sessionManager = FacebookSessionManager.getInstance(this)

        val toolbar: MaterialToolbar = findViewById(R.id.toolbar_login)
        toolbar.setNavigationOnClickListener { finish() }

        progressBar = findViewById(R.id.progress_loading)
        webView = findViewById(R.id.webview_facebook)
        val btnComplete: MaterialButton = findViewById(R.id.btn_complete_login)

        // Cấu hình WebView an toàn
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            userAgentString = "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
        }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                checkAndAutoSaveCookie(url)
            }
        }

        // Mở trang đăng nhập di động của Facebook
        webView.loadUrl("https://m.facebook.com/login")

        btnComplete.setOnClickListener {
            val url = webView.url ?: "https://m.facebook.com"
            val cookies = CookieManager.getInstance().getCookie(url) ?: ""

            if (cookies.contains("c_user=") && cookies.contains("xs=")) {
                sessionManager.saveSession(cookies)
                Toast.makeText(this, "✅ Đăng nhập và lưu Cookie thành công!", Toast.LENGTH_SHORT).show()
                finish()
            } else {
                Toast.makeText(this, "Vui lòng hoàn tất đăng nhập vào Facebook trước khi bấm nút này!", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun checkAndAutoSaveCookie(url: String?) {
        if (url == null) return
        val cookies = CookieManager.getInstance().getCookie(url) ?: return

        // Nếu đã xuất hiện c_user và xs, tài khoản đã đăng nhập thành công
        if (cookies.contains("c_user=") && cookies.contains("xs=")) {
            sessionManager.saveSession(cookies)
        }
    }
}
