package com.zalotofb.poster.data.photo

import android.content.Context
import android.graphics.*
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

object PhotoProcessor {

    private const val MAX_LONG_EDGE = 1600
    private const val JPEG_QUALITY = 85

    /**
     * Process an image:
     * 1. Decode bitmap
     * 2. Resize long edge to <= 1600px
     * 3. Optionally draw subtle watermark in bottom-right
     * 4. Save to cache dir as JPEG q85 (which automatically strips all EXIF and GPS tags)
     */
    suspend fun processImage(
        context: Context,
        inputUri: Uri,
        watermarkText: String? = null,
        watermarkAlpha: Float = 0.5f
    ): String? = withContext(Dispatchers.IO) {
        try {
            val contentResolver = context.contentResolver
            val inputStream = contentResolver.openInputStream(inputUri) ?: return@withContext null

            // 1. Decode bounds
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeStream(inputStream, null, options)
            inputStream.close()

            val srcWidth = options.outWidth
            val srcHeight = options.outHeight
            if (srcWidth <= 0 || srcHeight <= 0) return@withContext null

            // 2. Calculate sample size
            var sampleSize = 1
            val maxEdge = maxOf(srcWidth, srcHeight)
            while (maxEdge / sampleSize > MAX_LONG_EDGE * 2) {
                sampleSize *= 2
            }

            // 3. Decode scaled
            val decodeStream = contentResolver.openInputStream(inputUri) ?: return@withContext null
            val decodeOptions = BitmapFactory.Options().apply {
                inSampleSize = sampleSize
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            val baseBitmap = BitmapFactory.decodeStream(decodeStream, null, decodeOptions)
            decodeStream.close()

            if (baseBitmap == null) return@withContext null

            // 4. Exact scale to <= MAX_LONG_EDGE
            val currentMax = maxOf(baseBitmap.width, baseBitmap.height)
            val finalBitmap = if (currentMax > MAX_LONG_EDGE) {
                val scale = MAX_LONG_EDGE.toFloat() / currentMax.toFloat()
                val targetW = (baseBitmap.width * scale).toInt()
                val targetH = (baseBitmap.height * scale).toInt()
                val scaled = Bitmap.createScaledBitmap(baseBitmap, targetW, targetH, true)
                if (scaled != baseBitmap) baseBitmap.recycle()
                scaled
            } else {
                baseBitmap
            }

            // 5. Apply watermark if provided
            val outputBitmap = if (!watermarkText.isNullOrBlank()) {
                val mutableBitmap = finalBitmap.copy(Bitmap.Config.ARGB_8888, true)
                val canvas = Canvas(mutableBitmap)
                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = Color.WHITE
                    alpha = (watermarkAlpha.coerceIn(0f, 1f) * 255).toInt()
                    textSize = (mutableBitmap.width / 30f).coerceIn(24f, 48f)
                    setShadowLayer(4f, 2f, 2f, Color.BLACK)
                }

                val textBounds = Rect()
                paint.getTextBounds(watermarkText, 0, watermarkText.length, textBounds)
                val margin = (mutableBitmap.width * 0.03f).toInt()
                val x = (mutableBitmap.width - textBounds.width() - margin).toFloat()
                val y = (mutableBitmap.height - margin).toFloat()

                canvas.drawText(watermarkText, x, y, paint)
                if (mutableBitmap != finalBitmap) finalBitmap.recycle()
                mutableBitmap
            } else {
                finalBitmap
            }

            // 6. Save to internal cache dir (stripping all EXIF tags cleanly)
            val photosDir = File(context.filesDir, "listing_photos").apply { if (!exists()) mkdirs() }
            val outputFile = File(photosDir, "photo_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(6)}.jpg")
            FileOutputStream(outputFile).use { out ->
                outputBitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            }
            outputBitmap.recycle()

            Uri.fromFile(outputFile).toString()
        } catch (e: Exception) {
            null
        }
    }
}
