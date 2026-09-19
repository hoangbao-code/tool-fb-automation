package com.example.posthub.domain.template

import com.example.posthub.domain.model.Template
import com.example.posthub.domain.model.TemplateSelectionMode
import java.util.concurrent.atomic.AtomicInteger

object TemplatePicker {

    private val rotationIndex = AtomicInteger(0)

    /**
     * Chọn template theo chế độ của workspace / template:
     * - MANUAL: Trả về template được chỉ định hoặc template đầu tiên.
     * - ROTATE: Xoay vòng lần lượt qua từng mẫu để tránh bị Facebook đánh spam vì trùng nội dung.
     * - RANDOM: Chọn ngẫu nhiên trong danh sách mẫu.
     */
    fun pickTemplate(
        templates: List<Template>,
        preferredTemplateId: Long? = null,
        mode: TemplateSelectionMode = TemplateSelectionMode.MANUAL
    ): Template? {
        if (templates.isEmpty()) return null

        if (preferredTemplateId != null) {
            val found = templates.find { it.id == preferredTemplateId }
            if (found != null && mode == TemplateSelectionMode.MANUAL) {
                return found
            }
        }

        return when (mode) {
            TemplateSelectionMode.MANUAL -> {
                templates.find { it.id == preferredTemplateId } ?: templates.first()
            }
            TemplateSelectionMode.ROTATE -> {
                val idx = Math.abs(rotationIndex.getAndIncrement()) % templates.size
                templates[idx]
            }
            TemplateSelectionMode.RANDOM -> {
                templates.random()
            }
        }
    }
}
