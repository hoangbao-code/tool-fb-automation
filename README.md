# 🚀 Jammy_post_hub (Android App)

Ứng dụng cá nhân hỗ trợ quản lý và đăng tin cho thuê căn hộ/phòng:
Nhận tin từ Zalo -> Làm sạch, trích thông tin theo biến tùy biến -> Ráp bài theo template cá nhân -> Duyệt tin -> Đăng bài và quản lý nhóm Facebook qua WebView an toàn.

---

## 📱 Cài Đặt Trên Điện Thoại (Dành cho Người Dùng)

Bạn **không cần máy tính hay Android Studio** để cài đặt và thử nghiệm:
1. Mở trình duyệt trên điện thoại vào: [Bản phát hành Nightly](https://github.com/hoangbao-code/tool-fb-automation/releases/tag/nightly)
2. Tải file **`app-debug.apk`** mới nhất về máy.
3. Bấm cài đặt (có thể cài đè trực tiếp lên bản cũ mà không mất dữ liệu).
4. Mở app, thực hiện test theo checklist của từng mốc.
5. Khi cần báo cáo hoặc gửi log, vào tab **Nhật ký** -> Bấm **Sao chép** hoặc **Chia sẻ** qua Zalo.

---

## 🛠️ Công Nghệ Sử Dụng (Fixed Stack)

- **Ngôn ngữ**: Kotlin `1.9.24`
- **Gradle**: `8.7` (hỗ trợ setup-gradle trong GitHub Actions, không cần wrapper)
- **Android Gradle Plugin (AGP)**: `8.5.2`
- **Java**: JDK `17` (Target & Source compatibility)
- **SDK**: `compileSdk 34`, `targetSdk 34`, `minSdk 26`
- **Giao diện**: Jetpack Compose BOM `2024.06.00` (Compiler Extension `1.5.14`) + Material3
- **Kiến trúc**: Single module `:app`, Thủ công DI (`AppContainer`), không Hilt.

---

## 🗺️ Lộ Trình 7 Mốc (Milestones)

- [x] **M0: Khung repo + CI/CD + Giao diện 3 tab + AppLog**
- [ ] **M1: Bắt tin Zalo (Share target + NotificationListener)**
- [ ] **M2: CỔNG QUYẾT ĐỊNH - Facebook WebView Session (Assisted & Auto)**
- [ ] **M3: Room DB + Workspace + Template Engine + Màn hình Duyệt tin**
- [ ] **M4: MessageMerger + Deduplicator (SimHash, pHash) + Xử lý ảnh**
- [ ] **M5: Quản lý nhóm Facebook + Tự động duyệt trả lời câu hỏi vào nhóm**
- [ ] **M6: Foreground Service + Phím tắt thông báo + Khóa vân tay**
