package com.zalotofb.poster.domain.parser

import java.text.Normalizer

fun String.fold1to1(): String = buildString(this.length) {
    for (ch in this@fold1to1) {
        val c = when (ch) {
            'đ', 'Đ' -> 'd'
            else -> ch
        }
        val d = Normalizer.normalize(c.toString(), Normalizer.Form.NFD)
        append(d[0].lowercaseChar())
    }
}
