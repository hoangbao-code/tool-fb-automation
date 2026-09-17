# 🏢 CHDV Post Manager v2 — Android

**Ứng dụng chuyên biệt cho môi giới Căn hộ dịch vụ (CHDV / BĐS cho thuê tại TP.HCM).**  
Chuyển hóa tin nhắn Zalo lộn xộn từ các nhóm đầu chủ thành bài đăng Facebook chuẩn mực, sạch hoàn toàn thông tin nội bộ (hoa hồng, số chủ nhà), sinh 5 biến thể tránh bóp tương tác, gắn mã định danh lead theo từng nhóm và hỗ trợ đăng bài siêu tốc qua ứng dụng Facebook chính thức.

---

## 🔒 Triết Lý Kiến Trúc Bất Biến v2 (An Toàn Tuyệt Đối)

Phiên bản **v2** được tái cấu trúc triệt để theo tiêu chuẩn kỹ nghệ phần mềm chuyên nghiệp:
1. **100% Không Lưu Facebook Cookie / Token**: Không lưu `c_user`, `xs`, `fb_dtsg`, `jazoest`. Không đăng nhập WebView nguy hiểm.
2. **Loại Bỏ Hoàn Toàn `mbasic.facebook.com`**: Facebook đã khai tử giao diện mbasic từ 03/12/2024. Mọi cơ chế upload ngầm giả lập trình duyệt đều dẫn tới khóa tài khoản (checkpoint).
3. **Cơ Chế Share-Assist Trực Tiếp**: App không can thiệp gửi request ngầm. Khi bấm **Đăng bài**, app tự động:
   - Copy biến thể nội dung chuẩn và mã tracking tương ứng vào Clipboard.
   - Nạp toàn bộ ảnh phòng đã xóa siêu dữ liệu EXIF/GPS (chống bị Facebook quét ảnh trùng) và đóng dấu Watermark Hotline.
   - Kích hoạt thẳng ứng dụng Facebook chính thức hoặc deep link `fb://group/{id}` để bạn chỉ việc bấm **Đăng** — hoàn toàn là hành vi người dùng thật, **an toàn vĩnh viễn 100% cho tài khoản**.
4. **Offline-First Thuần Túy**: Toàn bộ bộ não xử lý văn bản tiếng Việt, bóc tách giá phòng, loại trừ hoa hồng, quản lý kho phòng hoạt động mượt mà ngay cả khi bật **Chế độ máy bay (Airplane Mode)**.

---

## ✨ Các Tính Năng Cốt Lõi

### 1. 🤖 Bộ Não NLP Bóc Tách Tin Phòng & Lọc Hoa Hồng (Domain Layer)
- **Fold 1:1 bảo toàn vị trí ký tự**: Xử lý dấu tiếng Việt, chữ hoa/thường, ký tự đặc biệt theo độ dài 1:1, bảo đảm vết cắt chuỗi chính xác tuyệt đối.
- **Xóa sạch 100% hoa hồng nội bộ**: Tự động nhận diện và cắt bỏ mọi biến thể hoa hồng đầu chủ (`HH 50%`, `hh 1 tháng`, `phí mg 3tr`, `cắt 500k`, `phí 1/2 th`, `mg 30%`...).
- **Xóa số điện thoại chủ nhà**: Thay thế bằng số Hotline/Zalo của bạn; loại bỏ nguy cơ khách thuê liên hệ trực tiếp chủ nhà hoặc lộ thông tin nguồn.
- **Nhận diện trường thông minh**:
  - **Loại phòng**: Studio (ban công/cửa sổ), Duplex / Gác lửng, 1PN, 2PN, 3PN, Penthouse, Phòng trọ...
  - **Giá thuê**: Phân tích đa ứng viên, hỗ trợ giá đơn (`6tr`, `7.5 triệu`), khoảng giá (`2tr5 - 3tr`, `4.5 - 5tr`), cọc, điện/nước.
  - **Vị trí**: Nhận diện 2 cấp (Quận 1, Quận 3, Bình Thạnh, Phú Nhuận, Tân Bình, Gò Vấp, Thủ Đức...) kèm tên đường, hẻm, phường.
  - **Tiện ích**: Ban công, thang máy, máy giặt riêng, hầm xe, bảo vệ 24/7, full nội thất, giờ giấc tự do, nuôi pet...

### 2. 📝 5 Biến Thể Bài Đăng & Mã Nhận Diện Lead (#BT01)
- Tạo 5 cấu trúc bài viết khác nhau (Cảm xúc, Liệt kê chuyên nghiệp, Giật tít vị trí, Tập trung giá rẻ, Sang trọng).
- Tự động luân phiên biến thể giữa các nhóm để thuật toán Facebook không bóp tương tác do spam nội dung trùng lặp.
- **Mã định danh nhóm tự động (#BT01, #PN02, #Q103...)**: Đặt ở cuối bài. Khi khách hàng chụp màn hình hoặc gửi link hỏi phòng, môi giới biết ngay khách đến từ nhóm nào và tình trạng phòng ở nhóm đó ra sao.

### 3. 📷 Xử Lý Ảnh Chuyên Nghiệp (Photo Processor)
- Tự động nén ảnh giữ độ nét cao, kích thước tối ưu (cạnh dài ≤ 1600px, JPEG q85).
- **Tẩy sạch siêu dữ liệu EXIF / GPS**: Bảo vệ quyền riêng tư và giúp Facebook nhận diện đây là ảnh độc lập mới.
- Đóng dấu chìm Watermark Hotline & Zalo môi giới ở góc ảnh để chống đối thủ tải trộm ảnh đăng lại.

### 4. 🧭 Hệ Thống 5 Tab Chuyên Nghiệp
- 📦 **Kho phòng**: Quản lý vòng đời tin đăng theo 5 trạng thái (`NHÁP`, `SẴN SÀNG`, `ĐANG ĐĂNG`, `ĐÃ THUÊ`, `HẾT HẠN`). Tự động cảnh báo tin đăng quá 14 ngày cần kiểm tra lại chủ nhà.
- 🚀 **Phiên đăng bài**: Hướng dẫn đăng tuần tự qua từng nhóm Facebook mục tiêu với 1 chạm, hỗ trợ đánh dấu kết quả (Đã đăng, Chờ duyệt admin, Bỏ qua).
- 👥 **Nhóm Facebook**: Quản lý nhóm theo Quận, gắn mã tracking tự động, hỗ trợ nạp nhóm từ Share link hoặc dán danh sách hàng loạt.
- 📊 **Thống kê**: Thống kê số lượng bài đã đăng, hiệu quả từng nhóm Facebook, tỷ lệ chốt phòng thành công.
- ⚙️ **Cài đặt**: Cấu hình Hotline, chữ ký bài viết cá nhân, mẫu template tùy biến, phân quyền lắng nghe thông báo Zalo.

---

## 📲 Hướng Dẫn Tải & Cài Đặt File APK

### 1. Tải ứng dụng
- Vào tab [**Releases**](https://github.com/hoangbao-code/tool-fb-automation/releases) hoặc [**Actions**](https://github.com/hoangbao-code/tool-fb-automation/actions) của kho lưu trữ.
- Tải file **`app-release.apk`** (bản chính thức đã được tối ưu và ký số) hoặc **`app-debug.apk`**.

### 2. Khắc phục lỗi "Ứng dụng chưa được cài đặt" (App not installed)
Bản phát hành v2 đã được **ký số hoàn chỉnh với đầy đủ các chuẩn Android v1, v2, v3 (RSA 2048-bit)**. Nếu điện thoại của bạn hiện thông báo chặn:
1. **Nếu đã có bản cũ trên máy**: Hãy gỡ bỏ bản cài đặt cũ trước khi cài bản v2 mới.
2. **Bật cho phép cài đặt từ nguồn không xác định**:
   - Khi mở file APK, nếu hệ thống hỏi "Cho phép cài đặt từ nguồn này" ➔ Bấm **Cho phép (Allow)**.
3. **Cảnh báo Google Play Protect**:
   - Bấm **"Chi tiết hơn" (More details)** ➔ Chọn **"Vẫn cài đặt" (Install anyway)**. (Do đây là ứng dụng nội bộ chưa phát hành lên Google Play Store nên Play Protect sẽ hiển thị cảnh báo thông lệ).

---

## 🛠️ Hướng Dẫn Biên Dịch Từ Mã Nguồn (Developer Guide)

Yêu cầu môi trường:
- **JDK**: Java 17 (khuyến nghị OpenJDK 17 / Eclipse Temurin 17).
- **Android SDK**: `platforms;android-34`, `build-tools;34.0.0`.

```bash
# Chạy toàn bộ bộ test NLP & Corpus
./gradlew test

# Biên dịch bản Debug APK
./gradlew assembleDebug

# Biên dịch bản Release APK đã ký số
./gradlew assembleRelease
```
