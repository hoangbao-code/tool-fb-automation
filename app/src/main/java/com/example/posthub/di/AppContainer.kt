package com.example.posthub.di

import android.content.Context
import com.example.posthub.data.AppLog

/**
 * Thủ công DI Container (Manual Dependency Injection)
 * Quản lý các singleton dependencies toàn ứng dụng, không dùng Hilt để giữ kiến trúc gọn nhẹ,
 * giảm thời gian biên dịch và tránh lỗi inject ngầm khi build từ xa qua CI.
 */
class AppContainer(val context: Context) {

    init {
        AppLog.i("AppContainer", "Khởi tạo AppContainer (Manual DI) hoàn tất.")
    }

    // Các repository và service sẽ được bổ sung dần theo từng mốc (M1, M2, M3...)
}
