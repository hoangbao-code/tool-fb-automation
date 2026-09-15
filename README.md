# 📱 Z2FB Post Manager - Android APK

**Ứng dụng Android chuyên dụng: Tự động & Bán tự động lấy bài đăng (văn bản + album ảnh) từ nhóm chat Zalo chuyển tiếp lên các Group Facebook.**

---

## ✨ Tính Năng Nổi Bật

### 1. 📥 Thu thập bài viết từ Nhóm Zalo thông minh
- **Lắng nghe thông báo ngầm (`NotificationListenerService`)**: Tự động phát hiện khi nhóm Zalo mục tiêu có tin nhắn mới mà không cần mở app Zalo.
- **Gom bài nhiều ảnh (`PostBatcher`)**: Tự động gộp các tin nhắn ảnh gửi dồn dập trong vòng 15-20 giây của cùng một người bán thành một bài viết hoàn chỉnh kèm album ảnh.
- **Hỗ trợ Chia sẻ trực tiếp (`Share Target`)**: Khi đang lướt Zalo, bạn chỉ cần chọn ảnh/bài viết và bấm **"Chia sẻ"** ➔ chọn **Z2FB Manager** để nạp ngay bài viết với ảnh gốc độ phân giải cao HD.

### 2. ⚡ Bộ Lọc & Thay Thế Thông Tin Tự Động (`ContentFilterEngine`)
- **Tự động thay đổi Số điện thoại**: Tự động quét và thay thế số điện thoại người bán cũ thành số điện thoại của bạn (`0988.888.888`).
- **Tự động xóa link rác**: Xóa các liên kết mời vào nhóm Zalo cũ (`zalo.me/...`).
- **Gắn chữ ký / Hotline / Hashtags**: Tự động thêm lời kết bán hàng và kêu gọi hành động (Call To Action) ở cuối mỗi bài đăng.
- **Lọc nhóm Zalo & Tin rác**: Chỉ nhận bài từ các nhóm bạn chỉ định; tự động bỏ qua các tin nhắn sticker, "chấm", tin nhắn quá ngắn.

### 3. 🎯 Hai Chế Độ Linh Hoạt

#### A. Chế độ Bán Tự Động (Semi-Auto)
- Khi Zalo có bài mới, màn hình Android sẽ xuất hiện **Bong bóng nổi (Floating Bubble)** tương tự bong bóng chat Messenger.
- Chạm vào bong bóng để mở cửa sổ xem trước nhanh:
  - Xem ảnh, đọc caption đã được sửa số điện thoại.
  - Bấm **[🚀 Duyệt]**: Bài viết lập tức được đưa vào hàng đợi đăng lên Facebook.
  - Bấm **[✏️ Sửa bài]**: Mở giao diện biên tập chi tiết (sửa chữ, thêm/bớt ảnh, chọn nhóm đăng).
  - Bấm **[Bỏ qua]**: Đóng pop-up nếu không muốn đăng bài đó.

#### B. Chế độ Tự Động 100% (Full-Auto)
- Chỉ cần bật công tắc **"Chế độ Tự Động Đăng"**.
- Cứ có tin nhắn mới từ nhóm Zalo chỉ định, ứng dụng sẽ tự động lọc, thay SĐT, gắn chữ ký và đăng lần lượt lên các Nhóm Facebook đã chọn.

### 4. 🛡️ Cơ Chế Đăng Bài Facebook Chống Checkpoint
- **Đăng nhập Cookie an toàn**: Đăng nhập tài khoản Facebook qua WebView nội bộ ngay trên máy điện thoại của bạn (không lưu trữ trên bất kỳ máy chủ nào khác).
- **Giãn cách an toàn (Anti-Ban Delay Jitter)**: Giãn cách ngẫu nhiên (ví dụ 180s - 240s giữa mỗi nhóm) để Facebook không đánh dấu tài khoản là spam.
- **Phương án dự phòng Share Intent**: Hỗ trợ chia sẻ trực tiếp sang ứng dụng Facebook chính thức (`com.facebook.katana`) với nội dung đã tự động sao chép vào clipboard.

---

## 🚀 Hướng Dẫn Biên Dịch (Build File APK)

### Cách 1: Tự động Build bằng GitHub Actions (Khuyên dùng, không cần cài Android Studio)
1. Khởi tạo Git và đẩy thư mục này lên tài khoản GitHub của bạn:
   ```bash
   git init
   git add .
   git commit -m "Initial Z2FB Android Project"
   git remote add origin https://github.com/USERNAME/z2fb-poster-apk.git
   git push -u origin main
   ```
2. Thư mục đã có sẵn workflow `.github/workflows/build_apk.yml`.
3. GitHub sẽ tự động build file APK trong khoảng 2 phút.
4. Bạn vào mục **Actions** trên GitHub ➔ Chọn bản build mới nhất ➔ Tải file **`app-debug.apk`** về và cài vào điện thoại Android.

---

### Cách 2: Mở bằng Android Studio trên máy tính
1. Tải và cài đặt [Android Studio](https://developer.android.com/studio).
2. Mở Android Studio ➔ Chọn **Open** ➔ Chọn thư mục `zalo_fb_poster_apk`.
3. Đợi Gradle đồng bộ (Sync) xong.
4. Trên thanh menu, chọn **Build ➔ Build Bundle(s) / APK(s) ➔ Build APK(s)**.
5. File `.apk` hoàn chỉnh sẽ nằm tại: `app/build/outputs/apk/debug/app-debug.apk`.
6. Copy file này vào điện thoại Android và cài đặt.

---

## 📲 Hướng Dẫn Cài Đặt & Sử Dụng Trên Điện Thoại Android

1. **Cài đặt APK**: Bật cho phép cài đặt ứng dụng từ nguồn không xác định trên Android.
2. **Cấp quyền hệ thống (chỉ cần làm 1 lần đầu)**:
   - Vào tab **Cài Đặt** trong app ➔ Bấm **Cấp quyền Bắt thông báo Zalo** ➔ Bật công tắc cho `Z2FB Manager`.
   - Bấm **Cấp quyền Bong bóng nổi** ➔ Bật cho phép hiển thị trên các ứng dụng khác.
3. **Đăng nhập Facebook**:
   - Vào tab **Nhóm Facebook** ➔ Bấm **Đăng nhập Facebook** ➔ Đăng nhập tài khoản FB của bạn ➔ Bấm **Tôi đã đăng nhập xong**.
   - Bấm **+ Thêm nhóm** để nhập ID các nhóm Facebook bạn muốn đăng bài.
4. **Cấu hình thông tin của bạn**:
   - Vào tab **Cài Đặt**: Nhập số điện thoại của bạn, nhập chữ ký cuối bài (Hotline, link bán hàng).
   - Nhập tên các nhóm Zalo cần lọc (hoặc để trống để nhận bài từ mọi nhóm).
5. **Bắt đầu sử dụng**:
   - Chọn chế độ **Bán tự động** hoặc **Tự động 100%** ngay tại tab **Hàng Đợi Bài**.
