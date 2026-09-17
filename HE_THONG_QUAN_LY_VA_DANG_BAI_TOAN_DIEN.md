# 📋 ĐẶC TẢ KIẾN TRÚC & GIẢI PHÁP TOÀN DIỆN
## HỆ THỐNG QUẢN LÝ VÀ ĐĂNG BÀI FACEBOOK TỰ ĐỘNG TỪ ZALO (Z2FB ALL-IN-ONE SUITE)

> **Mục tiêu:** Xây dựng một hệ thống hoàn chỉnh không chỉ để "bắn bài" đơn thuần, mà là một **Trung tâm Quản lý & Tự động hóa toàn diện**: Quản lý tài khoản Facebook, quét & phân loại nhóm, quản lý kho bài viết, tích hợp **Trí tuệ nhân tạo (AI)** tự động viết lại bài theo form mẫu định sẵn, gom tin từ Zalo và điều phối lịch đăng bài thông minh.

---

## 📑 MỤC LỤC
1. [Quản Lý Tài Khoản & Quét / Phân Tệp Nhóm Facebook](#1-quản-lý-tài-khoản--quét--phân-tệp-nhóm-facebook)
2. [Kho Nội Dung & Quản Lý Bài Đăng Đa Năng](#2-kho-nội-dung--quản-lý-bài-đăng-đa-năng)
3. [Bộ Não AI Viết Lại Nội Dung Theo Form Mẫu Định Sẵn](#3-bộ-não-ai-viết-lại-nội-dung-theo-form-mẫu-định-sẵn)
4. [Thu Thập Dữ Liệu Zalo & Xử Lý Vấn Đề Quyền Hệ Thống](#4-thu-thập-dữ-liệu-zalo--xử-lý-vấn-đề-quyền-hệ-thống)
5. [Cơ Chế Đăng Bài Thông Minh & Chống Checkpoint Facebook](#5-cơ-chế-đăng-bài-thông-minh--chống-checkpoint-facebook)
6. [Hai Chế Độ Vận Hành: Bán Tự Động & Tự Động 100%](#6-hai-chế-độ-vận-hành-bán-tự-động--tự-động-100)
7. [Đánh Giá Kiến Trúc Nền Tảng (APK Thuần vs Web App Mobile)](#7-đánh-giá-kiến-trúc-nền-tảng-apk-thuần-vs-web-app-mobile)

---

## 1. Quản Lý Tài Khoản & Quét / Phân Tệp Nhóm Facebook

Thay vì chỉ nhập mã nhóm thủ công, hệ thống sở hữu đầy đủ bộ công cụ quản trị nhóm và tài khoản:

### A. Quản Lý Đa Tài Khoản Facebook (Multi-Account Manager)
- **Thêm và lưu trữ nhiều tài khoản:** Hỗ trợ đăng nhập nhiều tài khoản Facebook bằng Cookie hoặc quét phiên làm việc.
- **Kiểm tra trạng thái (Live/Die Check):** Tự động kiểm tra xem Cookie của tài khoản còn hoạt động hay đã hết hạn/bị checkpoint để cảnh báo người dùng.
- **Xoay vòng tài khoản (Account Rotation):** Cho phép chọn tài khoản A đăng 5 nhóm, tài khoản B đăng 5 nhóm tiếp theo để giảm tải cho từng nick.

### B. Quét Nhóm Đã Tham Gia (Auto-Fetch Joined Groups)
- Hệ thống tự động kết nối và **quét toàn bộ danh sách các Group mà tài khoản Facebook của bạn đã tham gia**.
- Hiển thị đầy đủ thông tin: *Tên nhóm, ID nhóm, Số lượng thành viên, Loại nhóm (Công khai / Kín)*.
- Tránh việc bạn phải đi tìm và nhập từng ID nhóm bằng tay.

### C. Quét Tìm Nhóm Mới & Tự Động Tham Gia (Group Discovery & Auto-Join)
- **Tìm nhóm theo từ khóa:** Nhập từ khóa (VD: *"Sỉ quần áo", "Chợ đầu mối Ninh Hiệp", "Bất động sản Hà Nội"*).
- **Bộ lọc thông minh:** Lọc nhóm có số thành viên lớn hơn mức quy định (ví dụ chỉ lấy nhóm > 10.000 thành viên).
- **Tự động tham gia nhóm (Auto Join):** Thiết lập sẵn danh sách câu trả lời tự động cho các nhóm có kiểm duyệt hỏi đáp.
- **Tự động rời nhóm (Auto Leave):** Lọc và out hàng loạt các nhóm không tương tác hoặc nhóm đã chết.

### D. Phân Loại Tệp Nhóm Theo Chủ Đề (Group Segmentation / Tagging)
- Bạn có thể gom các nhóm thành từng **Tệp phân loại** riêng biệt:
  - *Tệp 1: Nhóm Sỉ Thời Trang (15 nhóm)*
  - *Tệp 2: Nhóm Mẹ & Bé (10 nhóm)*
  - *Tệp 3: Nhóm Chợ Cư Dân (20 nhóm)*
- Khi có bài đăng từ Zalo thuộc mặt hàng nào, bạn chỉ cần chọn Tệp tương ứng để đăng bài, không cần tích chọn lại từng nhóm.

---

## 2. Kho Nội Dung & Quản Lý Bài Đăng Đa Năng

Không chỉ nhận bài rồi đăng ngay, hệ thống cung cấp một **Kho bài viết (Content Hub)** chuyên nghiệp:

### A. Quản Lý Trạng Thái Bài Viết
Hệ thống phân tách bài viết theo các tab trạng thái rõ ràng:
1. **Bài Mới Lấy Từ Zalo (Pending/Drafts):** Chờ người dùng xem trước, sửa nội dung hoặc duyệt.
2. **Hàng Đợi Lên Lịch (Queued/Scheduled):** Các bài đã duyệt đang xếp hàng chờ đến giờ đăng.
3. **Đã Đăng Thành Công (Posted):** Lưu lại toàn bộ lịch sử kèm link bài viết trực tiếp trên từng nhóm Facebook để kiểm tra.
4. **Đăng Thất Bại (Failed):** Hiển thị rõ lý do (Group cần duyệt bài, nick bị chặn tạm thời, mạng lỗi...) và nút **[Thử lại]**.

### B. Bộ Biên Tập Chống Trùng Lặp Nội Dung (Anti-Duplication Engine)
Facebook có thuật toán quét bài viết trùng lặp (spam content). Hệ thống tích hợp sẵn:
- **Spin-tax văn bản:** Tự động tạo ra hàng trăm biến thể nội dung từ cùng một bài gốc:
  - Cú pháp: `{Chào cả nhà|Hello mọi người|Chào ace}, xả kho áo {giá rẻ|cực sốc|ưu đãi}...`
- **Mã băm vô hình (Zero-Width Hash):** Tự động chèn các ký tự ẩn không nhìn thấy bằng mắt thường vào giữa các chữ cái. Với người xem thì bài viết hoàn toàn bình thường, nhưng thuật toán Facebook sẽ nhận diện đây là bài viết duy nhất, không bị trùng mã hash.

### C. Cơ Chế Lên Lịch Đa Dạng (Campaign Scheduler)
- **Đăng ngay (Immediate):** Đăng tuần tự sang các nhóm đã chọn.
- **Hẹn giờ 1 lần (Once):** Cài đặt đăng vào khung giờ vàng (VD: 11h30 trưa hoặc 20h tối).
- **Lặp lại định kỳ (Recurring/Cron):** Tự động đăng lại bài viết vào các khung giờ cố định mỗi ngày.

---

## 3. Bộ Não AI Viết Lại Nội Dung Theo Form Mẫu Định Sẵn

> 🌟 **Giải quyết bài toán thực tế:** Tin nhắn từ nhóm Zalo của các đầu nậu/chủ sỉ thường rất sơ sài, viết tắt lộn xộn (`slg, sz, ib, freeship, sỉ 85k...`), dính tên thương hiệu và số điện thoại của người khác. AI đóng vai trò như **một chuyên viên Content Marketing** chuyên nghiệp, tự động chuyển hóa tin Zalo thô thành bài viết bán hàng Facebook hoàn chỉnh theo đúng khung mẫu của bạn.

### A. Tùy Biến Form Mẫu Bài Viết (Custom Content Template)
Bạn có thể tự thiết lập sẵn cấu trúc bài viết mẫu trong phần Cài đặt của Tool. Ví dụ:

```text
🔥 [TIÊU ĐỀ GIẬT TÍT & TÊN SẢN PHẨM] 🔥

👉 ƯU ĐIỂM NỔI BẬT:
- [Đặc điểm 1, chất liệu, xuất xứ trích từ Zalo]
- [Đặc điểm 2, form dáng, tính năng]

🎨 BẢNG MÀU & KÍCH THƯỚC:
- Size: [Liệt kê size và cân nặng phù hợp]
- Màu sắc: [Các màu có sẵn]

💰 GIÁ BÁN ƯU ĐÃI:
- Giá lẻ: [AI tự tính theo công thức hoặc giữ nguyên]
- Mua từ 2 sản phẩm: Miễn phí vận chuyển toàn quốc!

🛡️ CAM KẾT VÀ BẢO HÀNH:
- Kiểm tra hàng trước khi thanh toán.
- Lỗi 1 đổi 1 trong 7 ngày nếu có lỗi từ nhà sản xuất.

☎️ THÔNG TIN LIÊN HỆ ĐẶT HÀNG:
- Hotline / Zalo: 0988.888.888
- Địa chỉ kho: Tổng kho sỉ Miền Bắc

#Hashtags: #[Tên_Sản_Phẩm] #[Ngành_Hàng] #bansi #giare #chatluong
```

### B. Cơ Chế Hoạt Động Của Trí Tuệ Nhân Tạo (AI Pipeline)
1. **Trích xuất thực thể (Entity Extraction):** AI tự động bóc tách các dữ liệu quan trọng từ tin Zalo:
   - Tên món đồ, chất liệu vải, tính năng.
   - Bảng size, màu sắc, số lượng tối thiểu.
   - Giá sỉ / giá nhập gốc.
2. **Dịch thuật ngữ bán hàng:** Dịch các từ viết tắt chuyên môn:
   - `slg` ➔ Số lượng
   - `sz M, L` ➔ Đủ size từ M đến L (cho người từ 45 - 70kg)
   - `vnxk` ➔ Hàng Việt Nam Xuất Khẩu chuẩn xịn
   - `ctv` ➔ Cộng tác viên / Khách sỉ
3. **Lọc sạch 100% rác Zalo:** Loại bỏ hoàn toàn tên shop cũ, số điện thoại của chủ sỉ Zalo, link nhóm Zalo cũ.
4. **Tự động áp dụng công thức giá (Tùy chọn):**
   - Bạn có thể đặt công thức: `Giá Facebook = Giá Zalo + 40.000đ` (hoặc nhân hệ số 1.3). AI sẽ tự động tính toán và đưa ra giá bán lẻ niêm yết mà bạn không cần phải ngồi bấm máy tính tính lãi.
5. **Đa dạng phong cách viết (Tone of Voice):**
   - *Hài hước, gần gũi:* Dành cho nhóm chợ dân sinh, đồ ăn, thời trang bình dân.
   - *Uy tín, sang chảnh:* Dành cho hàng cao cấp, mỹ phẩm, đồ gia dụng.
   - *Giật tít, xả kho gấp:* Dành cho bài thanh lý, đại hạ giá.

### C. Trải Nghiệm Điều Khiển Trên Điện Thoại
- **Bán tự động:** Khi có tin Zalo mới ➔ AI tạo ngay bản nháp ➔ Màn hình điện thoại hiển thị song song 2 cột:
  - *Bên trái:* Tin Zalo gốc lộn xộn.
  - *Bên phải:* Bài viết Facebook bóng bẩy theo đúng Form của bạn.
  - Bạn chỉ cần xem lướt qua, có thể bấm `[🤖 Yêu cầu AI viết lại kiểu khác]` hoặc bấm `[🚀 Duyệt Đăng]`.
- **Tự động 100%:** AI nhận tin Zalo ➔ Tự ráp vào Form mẫu ➔ Tự động đẩy thẳng vào hàng đợi đăng Facebook mà bạn không cần chạm tay.

---

## 4. Thu Thập Dữ Liệu Zalo & Xử Lý Vấn Đề Quyền Hệ Thống

### A. Vì Sao Điện Thoại Bị Chặn Quyền Đọc Thông Báo Zalo?
Trên Android 13, 14 và đặc biệt là hệ điều hành **Xiaomi / Redmi (MIUI / HyperOS)**:
- Google và Xiaomi đã áp dụng chính sách **"Cài đặt bị hạn chế" (Restricted Settings)** đối với các file `.apk` cài từ ngoài CH Play.
- Người dùng khi vào cấp quyền "Truy cập thông báo" (Notification Listener) thường thấy nút gạt bị mờ đi và thông báo: *"Cài đặt bị hạn chế để bảo vệ bạn"*.

#### 💡 Cách mở khóa quyền trên điện thoại Xiaomi:
1. Vào **Cài đặt** của máy ➔ Chọn **Ứng dụng** ➔ **Quản lý ứng dụng**.
2. Tìm và bấm vào ứng dụng **Z2FB Manager**.
3. Bấm vào biểu tượng **dấu 3 chấm (⋮)** ở góc trên cùng bên phải màn hình.
4. Chọn: **"Cho phép các cài đặt bị hạn chế" (Allow restricted settings)**.
5. Sau bước này, bạn mới có thể vào lại phần Cấp quyền thông báo và bật công tắc bình thường!

### B. Cơ Chế Gom Bài & Tải Ảnh Từ Zalo
- **Lọc theo nhóm chỉ định:** Chỉ bắt tin nhắn từ đúng các nhóm Zalo bạn cần lấy hàng, bỏ qua tin nhắn riêng tư và nhóm bạn bè.
- **Bộ đệm gộp bài (Post Batcher):** Tự động gom 3 – 10 ảnh gửi liên tiếp trong vòng 15 – 20 giây của cùng người gửi thành 1 bài viết duy nhất kèm album ảnh.
- **Hỗ trợ chia sẻ 1 chạm (Share Sheet):** Khi đang ở trong Zalo, chỉ cần bấm nút "Chia sẻ" bài viết ➔ chọn Z2FB Tool để nạp toàn bộ ảnh gốc chất lượng cao HD.

---

## 5. Cơ Chế Đăng Bài Thông Minh & Chống Checkpoint Facebook

Đăng bài vào nhiều nhóm bằng nick Facebook nếu không có thuật toán an toàn sẽ rất nhanh bị khóa tính năng đăng bài:

| Cơ Chế Bảo Vệ | Cách Thức Hoạt Động | Lợi Ích |
| :--- | :--- | :--- |
| **Giãn cách an toàn (Delay Jitter)** | Sau khi đăng 1 nhóm, hệ thống tạm dừng ngẫu nhiên từ **120s đến 300s** (không cố định) trước khi đăng nhóm tiếp theo. | Ngụy trang như hành vi lướt và đăng bài của người thật, Facebook không thể quét ra bot. |
| **Giới hạn số bài/ngày (Daily Limit)** | Cài đặt trần đăng tối đa (VD: Tối đa 20 bài/ngày cho 1 tài khoản). | Tránh việc tài khoản bị quét hoạt động bất thường. |
| **Đăng qua Share Sheet App FB** | Thay vì gửi request ngầm, tool hỗ trợ mở thẳng ứng dụng Facebook thật và tự dán bài. | An toàn tuyệt đối 100%, Facebook nhận diện là thao tác trên ứng dụng chính thức. |
| **Ghi nhận lịch sử & Nhật ký lỗi** | Mọi thao tác đều có Live Log: bài đăng thành công lưu lại URL, bài lỗi lưu rõ nguyên nhân. | Giúp bạn kiểm soát và điều chỉnh nhóm đăng kịp thời. |

---

## 6. Hai Chế Độ Vận Hành: Bán Tự Động & Tự Động 100%

### A. Chế Độ Bán Tự Động (Kiểm Soát Tối Đa)
1. Zalo nhóm có bài mới ➔ AI tự động đọc tin, bóc tách và viết lại theo Form bài đăng Facebook của bạn.
2. Thông báo bài mới xuất hiện trên điện thoại:
   - Bạn mở ra xem trước bài viết (ảnh + chữ do AI viết).
   - Có thể chỉnh sửa nhanh giá bán hoặc câu chữ nếu muốn.
   - Chọn Tệp nhóm Facebook muốn bắn sang.
   - Bấm nút **[🚀 Duyệt & Đăng Ngay]** hoặc **[⏰ Hẹn Giờ]**.

### B. Chế Độ Tự Động 100% (Rảnh Tay Hoàn Toàn)
1. Bạn bật công tắc "Chế độ Auto", chọn sẵn Form mẫu AI và chọn Tệp nhóm Facebook mục tiêu.
2. Cứ khi nào nhóm Zalo có bài viết mới:
   - Hệ thống tự động lọc bỏ tin rác.
   - AI tự động viết lại bài theo form mẫu chuẩn SEO.
   - Tự động nạp vào hàng đợi và chạy ngầm đăng lần lượt sang các nhóm với thời gian giãn cách an toàn.
   - Đăng xong, gửi một thông báo tóm tắt về điện thoại: *"✅ Đã đăng thành công bài viết lên 5 nhóm Facebook"*.

---

## 7. Đánh Giá Kiến Trúc Nền Tảng (APK Thuần vs Web App Mobile)

Để có một hệ thống bao gồm **cả Quản lý chuyên sâu, Quét nhóm, Trí tuệ nhân tạo AI và Đăng bài**, bạn có 2 hướng kiến trúc:

### Mô hình 1: App APK Thuần Chạy Hoàn Toàn Trên Điện Thoại
- **Ưu điểm:** Cài trực tiếp trên điện thoại Android, không cần dùng máy tính.
- **Nhược điểm:**
  - Bị giới hạn bởi quyền hạn ngặt nghèo của Android (dễ bị hệ điều hành tắt ngầm khi khóa màn hình hoặc tiết kiệm pin).
  - Các tính năng phức tạp như quét hàng trăm nhóm Facebook, gọi AI xử lý bài viết liên tục, spin-tax trên điện thoại sẽ gây nóng máy và nhanh tụt pin.

### Mô hình 2: Mô hình Máy Chủ/PC Xử Lý + Giao Diện Web App Mobile (Khuyên Dùng)
*(Hệ thống giống như dự án `fb_group_automation` sẵn có trên máy tính của bạn, kết hợp giao diện Web tối ưu riêng cho màn hình điện thoại)*
- **Cách hoạt động:**
  - Bộ máy quét nhóm, nuôi tài khoản, gọi AI xử lý và tự động đăng bài chạy bền bỉ trên máy tính hoặc VPS.
  - Trên điện thoại Android, bạn chỉ cần mở trình duyệt truy cập bảng điều khiển (hoặc lưu icon ra màn hình chính dạng **PWA** dùng như một app native bình thường).
  - Bạn có thể điền form mẫu AI, quản lý danh sách nhóm, quét nhóm mới, duyệt bài viết Zalo và bật tắt Auto mọi lúc mọi nơi ngay trên điện thoại mà không làm nóng máy, không lo điện thoại bị ngắt quyền ngầm.

---

> 🛑 **DỰ ÁN TẠM DỪNG TẠI ĐÂY ĐỂ BẠN ĐỌC VÀ ĐÁNH GIÁ BẢN ĐẶC TẢ.**
