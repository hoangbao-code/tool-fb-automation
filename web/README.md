# 🚀 PostHub Web Desktop - Tự Động Hóa Zalo sang Facebook Cho Laptop

Hệ thống thu thập tin nhắn từ **Zalo Web** (`chat.zalo.me`) -> **AI Gemini viết lại chuyên nghiệp** -> **Đăng tự động lên các nhóm Facebook**, chạy trực tiếp trên máy tính Windows.

---

## 🌟 Ưu điểm vượt trội so với phiên bản điện thoại

1. **Không lo đăng nhập Zalo**: Tận dụng trực tiếp tab Zalo Web bạn đã đăng nhập sẵn trên trình duyệt máy tính. Không cần quét mã QR, không lo hết hạn 1p30s, không lo bị đá phiên!
2. **Userscript 1-Click**: Cài tiện ích Tampermonkey và nạp script `zalo_bridge.user.js` là tin nhắn từ các nhóm Zalo bạn theo dõi sẽ tự động truyền về hệ thống.
3. **Giao diện Web Dashboard trực quan**: Mở tại `http://localhost:3000`, có chế độ duyệt tay hoặc tự động hoàn toàn (Auto-Pilot).
4. **Giãn cách chống spam**: Tự động tạo độ trễ ngẫu nhiên giữa các bài đăng (3 - 8 phút) để bảo vệ tài khoản Facebook.

---

## ⚡ Hướng dẫn sử dụng nhanh (3 Bước)

### Bước 1: Khởi động hệ thống
- Nhấp đúp chuột vào file **`start.bat`** trong thư mục `web`.
- Trình duyệt sẽ tự động mở trang quản trị: **`http://localhost:3000`**.

### Bước 2: Cài đặt Zalo Bridge vào trình duyệt (Chỉ làm 1 lần duy nhất)
1. Cài tiện ích **[Tampermonkey](https://www.tampermonkey.net/)** vào Chrome hoặc Edge (nếu chưa có).
2. Trên Web Dashboard, bấm nút **"Tải Zalo Script"** (hoặc mở liên kết `http://localhost:3000/zalo_bridge.user.js`).
3. Tampermonkey sẽ hiện cửa sổ cài đặt -> Bấm **Cài đặt (Install)**.
4. Mở tab **[chat.zalo.me](https://chat.zalo.me)** -> Bạn sẽ thấy huy hiệu **"🟢 PostHub: Sẵn Sàng"** ở góc trên bên phải màn hình.

### Bước 3: Cấu hình và Hoạt động
1. **Zalo Monitor**: Thêm tên các nhóm Zalo bạn muốn lấy tin vào danh sách theo dõi.
2. **AI Gemini**: Nhập API Key miễn phí từ [Google AI Studio](https://aistudio.google.com/app/apikey) và tùy chỉnh mẫu prompt theo ý bạn.
3. **Facebook & Hàng đợi**: Thêm các nhóm Facebook bạn muốn đăng bài. Bật công tắc **"Tự động đăng bài"** để hệ thống tự vận hành 100%!

---

## 🛠️ Cấu trúc dự án

- `start.bat`: File khởi động 1-click trên Windows.
- `src/server.js`: Máy chủ Express & API REST cục bộ.
- `src/db.js`: Cơ sở dữ liệu SQLite lưu nhóm, bài viết và cài đặt.
- `src/services/gemini.js`: Dịch vụ gọi Google Gemini AI viết lại nội dung.
- `src/services/zaloReceiver.js`: Bộ đệm gộp tin nhắn (Message Merger) từ Zalo.
- `src/services/fbPoster.js`: Dịch vụ đăng bài Facebook và Worker giãn cách chống spam.
- `public/zalo_bridge.user.js`: Userscript bắt tin nhắn trên `chat.zalo.me`.
- `public/`: Toàn bộ giao diện Web Dashboard (HTML, CSS, JS).
