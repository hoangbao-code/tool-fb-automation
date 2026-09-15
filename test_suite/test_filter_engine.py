import re
import unittest

class ContentFilterEngine:
    VIETNAM_PHONE_REGEX = re.compile(r"(?:\+84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7}\b")
    ZALO_LINK_REGEX = re.compile(r"https?://(?:zalo\.me|chat\.zalo\.me)/\S+", re.IGNORECASE)

    @classmethod
    def process_content(cls, original_text: str, replacement_phone: str = "", signature: str = "") -> str:
        text = original_text
        if replacement_phone:
            text = cls.VIETNAM_PHONE_REGEX.sub(replacement_phone.strip(), text)
        text = cls.ZALO_LINK_REGEX.sub("", text).strip()
        if signature:
            text = f"{text}\n\n{signature.strip()}"
        return text.strip()

    @classmethod
    def is_group_monitored(cls, group_name: str, monitored_groups_str: str) -> bool:
        if not monitored_groups_str.strip():
            return True
        targets = [t.strip().lower() for t in monitored_groups_str.split(",") if t.strip()]
        if not targets:
            return True
        lower_group = group_name.lower()
        return any(t in lower_group for t in targets)

class TestContentFilterEngine(unittest.TestCase):
    def test_phone_replacement(self):
        sample = "Xả kho áo phao lông vũ giá 199k. Alo sđt 0912345678 hoặc 0398765432 để mua hàng!"
        res = ContentFilterEngine.process_content(sample, replacement_phone="0988888888", signature="☎️ Hotline: 0988888888")
        self.assertIn("0988888888", res)
        self.assertNotIn("0912345678", res)
        self.assertNotIn("0398765432", res)
        self.assertIn("Hotline: 0988888888", res)
        print("✅ Test Phone Replacement: PASSED")

    def test_link_removal(self):
        sample = "Nhóm sỉ tại https://zalo.me/g/abc12345 tham gia ngay nhé"
        res = ContentFilterEngine.process_content(sample)
        self.assertNotIn("https://zalo.me/g/abc12345", res)
        print("✅ Test Link Removal: PASSED")

    def test_group_monitoring(self):
        rules = "Sỉ Quần Áo, Kho Tổng Miền Bắc"
        self.assertTrue(ContentFilterEngine.is_group_monitored("Kho Sỉ Quần Áo VNXK", rules))
        self.assertTrue(ContentFilterEngine.is_group_monitored("Kho Tổng Miền Bắc Hàng Mới Về", rules))
        self.assertFalse(ContentFilterEngine.is_group_monitored("Gia Đình & Bạn Bè", rules))
        print("✅ Test Group Monitoring Filter: PASSED")

if __name__ == "__main__":
    unittest.main()
