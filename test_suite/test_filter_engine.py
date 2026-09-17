import re
import unittest

class CHDVContentFilterEngine:
    PHONE_REGEX = re.compile(r"(?:\+84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b")
    COMMISSION_REGEX = re.compile(r"(?i)(?:hh|hoa\s*hồng|phí\s*mg|phí\s*môi\s*giới|hh\s*ctv|hoa\s*hong)\s*[:=]?\s*\d+(?:[.,]\d+)?\s*(?:%|tháng|tr|triệu|k)?(?:\s*[-/]\s*\d+)?")
    ZALO_LINK_REGEX = re.compile(r"https?://(?:zalo\.me|chat\.zalo\.me)/\S+", re.IGNORECASE)

    @classmethod
    def extract_room_type(cls, text: str) -> str:
        lower = text.lower()
        if "duplex" in lower or "gác" in lower or "lửng" in lower:
            return "Duplex Gác Lửng"
        elif "studio" in lower or "stu" in lower:
            return "Studio Ban Công"
        elif "1pn" in lower or "1 phòng ngủ" in lower:
            return "1 Phòng Ngủ Riêng"
        elif "2pn" in lower or "2 phòng ngủ" in lower:
            return "2 Phòng Ngủ Cao Cấp"
        return "Căn Hộ Dịch Vụ"

    @classmethod
    def extract_district(cls, text: str) -> str:
        lower = text.lower()
        districts = [
            ("quận 1", "Quận 1"), ("q1", "Quận 1"),
            ("quận 3", "Quận 3"), ("q3", "Quận 3"),
            ("bình thạnh", "Bình Thạnh"), ("bt", "Bình Thạnh"),
            ("phú nhuận", "Phú Nhuận"), ("pn", "Phú Nhuận"),
            ("quận 10", "Quận 10"), ("q10", "Quận 10"),
            ("tân bình", "Tân Bình"), ("gò vấp", "Gò Vấp"),
        ]
        for key, name in districts:
            if key in lower:
                return name
        return "Trung Tâm"

    @classmethod
    def extract_price(cls, text: str) -> str:
        m = re.search(r"(?i)(\d+(?:[.,]\d+)?)\s*(?:tr|triệu|k)", text)
        if m:
            num = float(m.group(1).replace(",", "."))
            if 2.0 <= num <= 50.0:
                return f"{num:g} Triệu / tháng"
        return "Thỏa thuận"

    @classmethod
    def process_content(cls, raw_text: str, hotline: str, template: str) -> str:
        clean = cls.COMMISSION_REGEX.sub("", raw_text).strip()
        clean = cls.ZALO_LINK_REGEX.sub("", clean).strip()
        if hotline:
            clean = cls.PHONE_REGEX.sub(hotline.strip(), clean)

        room_type = cls.extract_room_type(clean)
        district = cls.extract_district(clean)
        price = cls.extract_price(clean)

        post = template.replace("[TIÊU ĐỀ GIẬT TÍT & LOẠI PHÒNG]", f"SIÊU PHẨM {room_type.upper()} CỰC ĐẸP TẠI {district.upper()}")
        post = post.replace("[Đường, Quận - Thuận tiện di chuyển]", f"Khu vực {district}")
        post = post.replace("[Giá thuê / tháng]", price)
        post = post.replace("[HOTLINE_VA_CHUKY]", f"☎️ Hotline/Zalo: {hotline} (Xem phòng miễn phí 24/7)")
        return post.strip()

class TestCHDVEngine(unittest.TestCase):
    def test_strip_commission_and_phone(self):
        sample = "Trống phòng 401 Duplex Lê Văn Sỹ Q3 giá 6.5tr, full nt, hh 50%, cọc 1 thanh toán 1, alo chủ nhà 0912345678 xem phòng. Link: https://zalo.me/g/phongtro"
        template = "🔥 [TIÊU ĐỀ GIẬT TÍT & LOẠI PHÒNG] 🔥\n📍 [Đường, Quận - Thuận tiện di chuyển]\n💰 Giá: [Giá thuê / tháng]\n[HOTLINE_VA_CHUKY]"
        result = CHDVContentFilterEngine.process_content(sample, hotline="0988.888.888", template=template)

        self.assertNotIn("hh 50%", result.lower())
        self.assertNotIn("0912345678", result)
        self.assertIn("0988.888.888", result)
        self.assertIn("DUPLEX", result)
        self.assertIn("QUẬN 3", result)
        self.assertIn("6.5 Triệu / tháng", result)
        self.assertNotIn("https://zalo.me", result)

if __name__ == "__main__":
    unittest.main()
