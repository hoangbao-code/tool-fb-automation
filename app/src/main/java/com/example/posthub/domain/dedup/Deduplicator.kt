package com.example.posthub.domain.dedup

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File

object Deduplicator {

    // SimHash 64-bit cho văn bản
    fun computeSimHash(text: String): Long {
        val cleanText = text.lowercase().replace(Regex("""[^\p{L}\p{Nd}\s]"""), " ")
        val tokens = cleanText.split(Regex("""\s+""")).filter { it.length > 1 }
        if (tokens.isEmpty()) return 0L

        val v = IntArray(64)
        for (token in tokens) {
            val hash = hash64(token)
            for (i in 0 until 64) {
                val bit = (hash shr i) and 1L
                if (bit == 1L) {
                    v[i] += 1
                } else {
                    v[i] -= 1
                }
            }
        }

        var simHash = 0L
        for (i in 0 until 64) {
            if (v[i] > 0) {
                simHash = simHash or (1L shl i)
            }
        }
        return simHash
    }

    private fun hash64(str: String): Long {
        var h = -3750763034362895579L // FNV-1a 64-bit offset basis
        for (b in str.toByteArray()) {
            h = h xor (b.toLong() and 0xFF)
            h = h * 1099511628211L // FNV prime
        }
        return h
    }

    fun hammingDistance(hash1: Long, hash2: Long): Int {
        var xor = hash1 xor hash2
        var distance = 0
        while (xor != 0L) {
            distance += (xor and 1L).toInt()
            xor = xor ushr 1
        }
        return distance
    }

    fun isNearDuplicateText(hash1: Long, hash2: Long, threshold: Int = 4): Boolean {
        if (hash1 == 0L || hash2 == 0L) return false
        return hammingDistance(hash1, hash2) <= threshold
    }

    // Perceptual Difference Hash (dHash) 64-bit cho ảnh
    fun computeImageDHash(imageFile: File): Long {
        return try {
            val bitmap = BitmapFactory.decodeFile(imageFile.absolutePath) ?: return 0L
            computeBitmapDHash(bitmap)
        } catch (e: Exception) {
            0L
        }
    }

    fun computeBitmapDHash(bitmap: Bitmap): Long {
        return try {
            // Resize về 9x8 pixel để so sánh 64 cặp điểm ảnh liền kề
            val scaled = Bitmap.createScaledBitmap(bitmap, 9, 8, true)
            var hash = 0L
            var bitIndex = 0

            for (y in 0 until 8) {
                for (x in 0 until 8) {
                    val p1 = scaled.getPixel(x, y)
                    val p2 = scaled.getPixel(x + 1, y)

                    // Tính độ sáng grayscale: 0.299R + 0.587G + 0.114B
                    val b1 = (p1 shr 16 and 0xFF) * 299 + (p1 shr 8 and 0xFF) * 587 + (p1 and 0xFF) * 114
                    val b2 = (p2 shr 16 and 0xFF) * 299 + (p2 shr 8 and 0xFF) * 587 + (p2 and 0xFF) * 114

                    if (b1 > b2) {
                        hash = hash or (1L shl bitIndex)
                    }
                    bitIndex++
                }
            }
            hash
        } catch (e: Exception) {
            0L
        }
    }

    fun isNearDuplicateImage(hash1: Long, hash2: Long, threshold: Int = 10): Boolean {
        if (hash1 == 0L || hash2 == 0L) return false
        return hammingDistance(hash1, hash2) <= threshold
    }
}
