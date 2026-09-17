import unittest
import re

GROUP_LINK_REGEX = re.compile(
    r"""href=["'](?:https?://(?:m|mbasic)\.facebook\.com)?/groups/(\d+)[^"']*["'][^>]*>(.*?)</a>""",
    re.IGNORECASE
)

sample_html = '''
<div class="groups">
  <a href="/groups/10293847561234/?refid=27">Hội Cho Thuê Căn Hộ Quận 3 &amp; Q1</a>
  <a href="https://mbasic.facebook.com/groups/55667788990011/?ref=bookmarks">Phòng Trọ Bình Thạnh <b>Giá Rẻ</b></a>
  <a href="/groups/999888777666/">Tạo nhóm mới</a>
  <a href="/groups/112233445566/?ref=see_more">Xem thêm</a>
  <a href="/groups/778899001122/">CHDV Studio &amp; Duplex Phú Nhuận</a>
</div>
'''

class TestGroupScanner(unittest.TestCase):
    def test_regex_parsing(self):
        matches = GROUP_LINK_REGEX.findall(sample_html)
        groups = []
        ignored = {'tạo nhóm mới', 'xem thêm'}
        for gid, raw_name in matches:
            clean = re.sub(r'<[^>]+>', '', raw_name).replace('&amp;', '&').strip()
            if clean.lower() not in ignored:
                groups.append((gid, clean))
        
        self.assertEqual(len(groups), 3)
        self.assertEqual(groups[0], ('10293847561234', 'Hội Cho Thuê Căn Hộ Quận 3 & Q1'))
        self.assertEqual(groups[1], ('55667788990011', 'Phòng Trọ Bình Thạnh Giá Rẻ'))
        self.assertEqual(groups[2], ('778899001122', 'CHDV Studio & Duplex Phú Nhuận'))

if __name__ == '__main__':
    unittest.main()
