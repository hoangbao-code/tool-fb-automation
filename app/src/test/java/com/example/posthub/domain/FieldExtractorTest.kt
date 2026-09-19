package com.example.posthub.domain

import com.example.posthub.domain.extractor.FieldExtractor
import com.example.posthub.domain.model.FieldDef
import com.example.posthub.domain.model.IfMissingPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FieldExtractorTest {

    @Test
    fun testExtractStandardFields() {
        val sampleText = """
            Cho thuê căn hộ cao cấp full nội thất tại Bình Thạnh
            Giá chỉ 5.5tr/tháng, diện tích 30m2.
            Dạng phòng Studio ban công thoáng mát.
            Liên hệ xem phòng: 0901234567 gặp chính chủ.
        """.trimIndent()

        val fieldDefs = listOf(
            FieldDef(workspaceId = 1, key = "gia", ifMissing = IfMissingPolicy.SKIP_LINE),
            FieldDef(workspaceId = 1, key = "quan", ifMissing = IfMissingPolicy.SKIP_LINE),
            FieldDef(workspaceId = 1, key = "dien_tich", ifMissing = IfMissingPolicy.SKIP_LINE),
            FieldDef(workspaceId = 1, key = "loai_phong", ifMissing = IfMissingPolicy.SKIP_LINE),
            FieldDef(workspaceId = 1, key = "sdt", ifMissing = IfMissingPolicy.ASK_ME)
        )

        val extracted = FieldExtractor.extractFields(sampleText, fieldDefs)

        assertTrue("Phải trích xuất được giá", extracted["gia"]?.contains("5.5tr") == true)
        assertTrue("Phải trích xuất được quận", extracted["quan"]?.contains("Bình Thạnh", ignoreCase = true) == true)
        assertTrue("Phải trích xuất được diện tích", extracted["dien_tich"]?.contains("30m2") == true)
        assertTrue("Phải trích xuất được loại phòng", extracted["loai_phong"]?.equals("Studio", ignoreCase = true) == true)
        assertEquals("Phải trích xuất được số điện thoại", "0901234567", extracted["sdt"])
    }
}
