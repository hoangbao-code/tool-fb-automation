# 📋 Zalo Notification & Share Target Findings

Tài liệu này tổng hợp cấu trúc dữ liệu thực tế mà ứng dụng Zalo (package `com.zing.zalo`) cung cấp cho hệ điều hành Android thông qua hai kênh chính: **Share Target** và **NotificationListenerService**.

---

## 1. Kênh Share Target (Zalo -> Chia sẻ -> Jammy_post_hub)

- **Intent Action**:
  - Khi chia sẻ 1 ảnh/text: `android.intent.action.SEND`
  - Khi chia sẻ nhiều ảnh: `android.intent.action.SEND_MULTIPLE`
- **MIME Types**:
  - Text: `text/plain`
  - Ảnh: `image/*` (thường là `image/jpeg` hoặc `image/png`)
- **Dữ liệu trong Intent**:
  - `Intent.EXTRA_TEXT`: Chứa toàn bộ nội dung văn bản tin nhắn được chọn chia sẻ.
  - `Intent.EXTRA_STREAM`: Chứa `Uri` của các file ảnh được chọn.
- **Lưu ý kỹ thuật sống còn (Android 13/14)**:
  - Quyền đọc `content://` URI chỉ là tạm thời (`FLAG_GRANT_READ_URI_PERMISSION`).
  - `ShareReceiverActivity` phải mở `InputStream` và sao chép ngay lập tức vào bộ nhớ trong của ứng dụng (`context.filesDir/zalo_images/`) trước khi gọi `finish()`.

---

## 2. Kênh Tự Động: NotificationListenerService

- **Package định danh**: `com.zing.zalo` (mặc định, có thể cấu hình lại trong Cài đặt).
- **Cấu trúc Bundle Extras của Zalo Notification**:
  - `android.title`: Tên người gửi tin nhắn hoặc tên nhóm Zalo.
  - `android.text`: Dòng nội dung tin nhắn ngắn.
  - `android.bigText`: Nội dung tin nhắn đầy đủ khi được mở rộng (nếu tin nhắn dài).
  - `android.subText`: Tên nhóm Zalo (trong trường hợp người gửi gửi vào nhóm).
  - `android.template`: Thường là `android.app.Notification$BigTextStyle` hoặc `MessagingStyle`.
- **Hạn chế của Notification Zalo**:
  - Không truyền tải kèm ảnh bitmap qua notification extras (chỉ có chữ).
  - Nếu người dùng tắt thông báo của nhóm Zalo trong cài đặt Zalo, Android sẽ không nhận được notification.
  - Tin nhắn dài trên 500 ký tự có thể bị cắt bớt nếu Zalo không đưa vào `EXTRA_BIG_TEXT`.

---

## 3. Quy Trình Xử Lý Gộp Tin (MessageMerger)

Do người đăng trên Zalo thường gửi tin nhắn thành 3-4 tin rời rạc:
1. Tin 1: Tiêu đề + Địa chỉ
2. Tin 2: Danh sách ảnh
3. Tin 3: Giá + Số điện thoại liên hệ

`MessageMerger` áp dụng cửa sổ trượt 20 giây (`Sliding Window`) theo người gửi hoặc tên nhóm. Toàn bộ các tin gửi đến trong 20s sẽ được tự động gom vào cùng 1 bài viết nháp trước khi chuyển sang màn hình Duyệt bài.
