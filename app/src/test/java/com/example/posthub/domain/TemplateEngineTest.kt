package com.example.posthub.domain

import com.example.posthub.domain.model.FieldDef
import com.example.posthub.domain.model.IfMissingPolicy
import com.example.posthub.domain.template.TemplateEngine
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TemplateEngineTest {

    @Test
    fun testTemplateEngineRendering() {
        val template = """
            🏢 CHO THUÊ PHÒNG TẠI {quan}
            💰 Giá thuê: {gia}
            {?dien_tich}📐 Diện tích: {dien_tich}{/?}
            📞 Liên hệ: {sdt}
            🏠 Ghi chú: {ghi_chu}
        """.trimIndent()

        val variables = mapOf(
            "quan" to "Quận 1",
            "gia" to "6.5 triệu",
            "sdt" to "0911222333"
            // "dien_tich" và "ghi_chu" bị thiếu
        )

        val fieldDefs = listOf(
            FieldDef(workspaceId = 1, key = "quan", ifMissing = IfMissingPolicy.SKIP_LINE),
            FieldDef(workspaceId = 1, key = "gia", ifMissing = IfMissingPolicy.KEEP_PLACEHOLDER),
            FieldDef(workspaceId = 1, key = "dien_tich", ifMissing = IfMissingPolicy.SKIP_LINE),
            FieldDef(workspaceId = 1, key = "sdt", ifMissing = IfMissingPolicy.ASK_ME),
            FieldDef(workspaceId = 1, key = "ghi_chu", ifMissing = IfMissingPolicy.SKIP_LINE)
        )

        val rendered = TemplateEngine.render(template, variables, fieldDefs)

        assertTrue("Phải chứa Quận 1", rendered.contains("CHO THUÊ PHÒNG TẠI Quận 1"))
        assertTrue("Phải chứa Giá thuê", rendered.contains("Giá thuê: 6.5 triệu"))
        assertTrue("Phải chứa Số điện thoại", rendered.contains("Liên hệ: 0911222333"))
        assertFalse("Khối điều kiện diện tích phải bị loại bỏ vì thiếu biến", rendered.contains("Diện tích"))
        assertFalse("Dòng ghi chú phải bị SKIP_LINE loại bỏ hoàn toàn", rendered.contains("Ghi chú"))
    }

    @Test
    fun testAskMePolicy() {
        val template = "Liên hệ ngay: {sdt}"
        val fieldDefs = listOf(
            FieldDef(workspaceId = 1, key = "sdt", ifMissing = IfMissingPolicy.ASK_ME)
        )
        val rendered = TemplateEngine.render(template, emptyMap(), fieldDefs)
        assertTrue("Chính sách ASK_ME phải tạo tag cần điền", rendered.contains("[CẦN ĐIỀN: sdt]"))
    }
}
