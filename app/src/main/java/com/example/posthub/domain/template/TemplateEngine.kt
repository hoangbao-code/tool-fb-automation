package com.example.posthub.domain.template

import com.example.posthub.domain.model.FieldDef
import com.example.posthub.domain.model.IfMissingPolicy
import java.util.regex.Pattern

object TemplateEngine {

    /**
     * Ráp template với bộ biến đã trích xuất, xử lý cú pháp điều kiện {?bien}...{/?}
     * và xử lý các chính sách khi thiếu biến (SKIP_LINE, KEEP_PLACEHOLDER, ASK_ME).
     */
    fun render(
        templateContent: String,
        variables: Map<String, String>,
        fieldDefs: List<FieldDef> = emptyList()
    ): String {
        val policyMap = fieldDefs.associate { it.key to it.ifMissing }

        // 1. Xử lý cú pháp điều kiện {?bien}...{/?}
        val conditionPattern = Pattern.compile("""\{\?([a-zA-Z0-9_]+)\}(.*?)\{/\?\}""", Pattern.DOTALL)
        var result = conditionPattern.matcher(templateContent).replaceAll { mr ->
            val key = mr.group(1)
            val innerContent = mr.group(2)
            val value = variables[key]?.trim()
            if (!value.isNullOrBlank()) {
                // Giữ lại nội dung bên trong điều kiện
                innerContent
            } else {
                // Xóa toàn bộ khối điều kiện
                ""
            }
        }

        // 2. Tách từng dòng để xử lý chính sách SKIP_LINE
        val lines = result.lines()
        val processedLines = mutableListOf<String>()

        val placeholderPattern = Pattern.compile("""\{([a-zA-Z0-9_]+)\}""")

        for (line in lines) {
            var skipThisLine = false
            var currentLine = line

            val matcher = placeholderPattern.matcher(line)
            val placeholdersInLine = mutableListOf<String>()
            while (matcher.find()) {
                placeholdersInLine.add(matcher.group(1))
            }

            for (key in placeholdersInLine) {
                val value = variables[key]?.trim()
                if (!value.isNullOrBlank()) {
                    currentLine = currentLine.replace("{$key}", value)
                } else {
                    // Xử lý khi thiếu biến
                    val policy = policyMap[key] ?: IfMissingPolicy.SKIP_LINE
                    when (policy) {
                        IfMissingPolicy.SKIP_LINE -> {
                            skipThisLine = true
                            break
                        }
                        IfMissingPolicy.KEEP_PLACEHOLDER -> {
                            // Giữ nguyên {key}
                        }
                        IfMissingPolicy.ASK_ME -> {
                            currentLine = currentLine.replace("{$key}", "[CẦN ĐIỀN: $key]")
                        }
                    }
                }
            }

            if (!skipThisLine) {
                processedLines.add(currentLine)
            }
        }

        // 3. Chuẩn hóa khoảng trống và dòng trống liên tiếp (tối đa 2 dòng trống liên tiếp)
        val joined = processedLines.joinToString("\n")
        return joined.replace(Regex("""\n{3,}"""), "\n\n").trim()
    }
}
