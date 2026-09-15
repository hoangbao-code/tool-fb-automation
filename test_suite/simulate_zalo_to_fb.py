import sys
import time
import json
import random
from test_filter_engine import ContentFilterEngine

def simulate_pipeline():
    print("=" * 65)
    print("GIẢ LẬP LUỒNG HOẠT ĐỘNG: ZALO GROUP -> Z2FB APP -> FACEBOOK GROUP")
    print("=" * 65)

    # 1. Cấu hình người dùng (AppSettings)
    settings = {
        "is_auto_mode": False, # Bán tự động trước
        "monitored_zalo_groups": "Sỉ Quần Áo VNXK, Tổng Kho Thời Trang",
        "replacement_phone": "0988.888.888",
        "signature_text": "☎️ Hotline/Zalo: 0988.888.888 - Giao hàng toàn quốc!",
        "anti_ban_delay_sec": 180,
        "target_fb_groups": [
            {"id": "100200300400", "name": "Hội Sỉ Lẻ Thời Trang Toàn Quốc"},
            {"id": "200300400500", "name": "Chợ Đầu Mối Kinh Doanh Online"}
        ]
    }
    print("[1] Cấu hình hệ thống:")
    print(f"    - Chế độ: {'Tự động 100%' if settings['is_auto_mode'] else 'Bán tự động (Duyệt trước khi đăng)'}")
    print(f"    - Nhóm Zalo theo dõi: {settings['monitored_zalo_groups']}")
    print(f"    - Số điện thoại của bạn: {settings['replacement_phone']}")
    print(f"    - Giãn cách an toàn (Anti-Ban Delay): {settings['anti_ban_delay_sec']}s")
    print("-" * 65)

    # 2. Tin nhắn đến từ Zalo
    incoming_zalo = {
        "group_name": "Kho Sỉ Quần Áo VNXK Toàn Quốc",
        "sender": "Chủ Kho Nam",
        "original_text": "Hàng mới về siêu hot! Áo khoác dù 2 lớp chống nước giá sỉ chỉ 85k. Bác nào lấy inbox hoặc gọi 0912345678 chốt nhanh nhé. Link nhóm: https://zalo.me/g/khohang123",
        "images": ["file:///cache/zalo_img_01.jpg", "file:///cache/zalo_img_02.jpg", "file:///cache/zalo_img_03.jpg"],
        "timestamp": time.time()
    }
    print("[2] Nhận thông báo mới từ Zalo:")
    print(f"    - Nhóm: {incoming_zalo['group_name']}")
    print(f"    - Người gửi: {incoming_zalo['sender']}")
    print(f"    - Số lượng ảnh: {len(incoming_zalo['images'])} ảnh")
    print(f"    - Text gốc: \"{incoming_zalo['original_text']}\"")
    print("-" * 65)

    # 3. Kiểm tra bộ lọc
    is_monitored = ContentFilterEngine.is_group_monitored(incoming_zalo["group_name"], settings["monitored_zalo_groups"])
    print(f"[3] Kiểm tra nhóm theo dõi: {'Khớp nhóm mục tiêu -> Xử lý tiếp' if is_monitored else 'Bỏ qua'}")
    if not is_monitored:
        return

    # 4. Content Filter Engine: Xử lý thay SĐT & Chữ ký
    processed_text = ContentFilterEngine.process_content(
        incoming_zalo["original_text"],
        replacement_phone=settings["replacement_phone"],
        signature=settings["signature_text"]
    )
    print("[4] Kết quả sau khi qua Bộ Lọc & Thay Thế Thông Tin:")
    print("-------------------- NỘI DUNG BÀI ĐĂNG FB --------------------")
    print(processed_text)
    print("-------------------------------------------------------------")

    # 5. Phân luồng theo chế độ
    if not settings["is_auto_mode"]:
        print("[5] Chế độ BÁN TỰ ĐỘNG:")
        print("    👉 Đang hiển thị Bong bóng nổi (Floating Bubble) trên màn hình Android.")
        print("    👉 Người dùng chạm vào Bong bóng: Xem trước 3 ảnh + caption đã thay SĐT.")
        print("    👉 Người dùng bấm: [🚀 DUYỆT & ĐĂNG NGAY]")
        time.sleep(1)
        print("    ✅ Người dùng đã duyệt bài viết!")
    else:
        print("[5] Chế độ TỰ ĐỘNG 100%: Bài viết tự động đưa vào hàng đợi đăng.")

    # 6. Đăng bài lên Facebook Groups với cơ chế Giãn cách an toàn
    print("[6] Bắt đầu tiến trình đăng lên các Nhóm Facebook mục tiêu:")
    for idx, group in enumerate(settings["target_fb_groups"], 1):
        if idx > 1:
            delay = random.randint(settings["anti_ban_delay_sec"] - 15, settings["anti_ban_delay_sec"] + 15)
            print(f"    ⏳ Giãn cách an toàn (Anti-Ban Jitter): Chờ {delay} giây trước khi đăng nhóm tiếp theo...")
        
        print(f"    🚀 Đang đăng bài lên nhóm [{group['name']}] (ID: {group['id']})...")
        print(f"       + Tải lên {len(incoming_zalo['images'])} ảnh lên Facebook CDN...")
        print(f"       + Gửi bài viết kèm caption...")
        fake_post_id = f"{group['id']}_{random.randint(10000000, 99999999)}"
        print(f"       ✅ Đăng thành công: https://facebook.com/groups/{group['id']}/posts/{fake_post_id}")

    print("=" * 65)
    print("🎉 HOÀN TẤT TOÀN BỘ TIẾN TRÌNH THÀNH CÔNG RỰC RỠ!")
    print("=" * 65)

if __name__ == "__main__":
    simulate_pipeline()
