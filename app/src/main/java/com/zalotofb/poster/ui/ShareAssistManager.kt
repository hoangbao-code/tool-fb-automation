package com.zalotofb.poster.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.core.content.FileProvider
import com.zalotofb.poster.data.local.entity.FbGroupEntity
import com.zalotofb.poster.domain.parser.ListingParser
import com.zalotofb.poster.domain.parser.fold1to1
import java.io.File
import java.util.regex.Pattern

data class PostSessionStep(
    val group: FbGroupEntity,
    val variantIndex: Int,
    val trackingCode: String,
    val renderedText: String,
    val photoUris: List<String>
)

object ShareAssistManager {

    /**
     * Extract group ID or slug from any Facebook URL format:
     * e.g. https://www.facebook.com/groups/1234567890/
     * e.g. https://m.facebook.com/groups/phongtrobinhthanh?ref=...
     */
    fun extractGroupIdOrSlug(url: String): String {
        val trimmed = url.trim()
        val regex = Regex("""groups/([a-zA-Z0-9._\-]+)""")
        val match = regex.find(trimmed)
        if (match != null) {
            return match.groupValues[1]
        }
        val numRegex = Regex("""(\d{8,20})""")
        val numMatch = numRegex.find(trimmed)
        if (numMatch != null) {
            return numMatch.groupValues[1]
        }
        return trimmed.replace(Regex("""[^a-zA-Z0-9]"""), "")
    }

    /**
     * Suggest district tag based on group name
     */
    fun suggestDistrictTag(groupName: String): String? {
        val folded = groupName.fold1to1()
        return ListingParser.extractDistrict(folded)
    }

    /**
     * Generate unique tracking code: e.g. "BT01", "Q701", "TD02"
     */
    fun generateTrackingCode(district: String?, existingCodes: Set<String>): String {
        val prefix = when (district) {
            "Quận 1" -> "Q1"
            "Quận 3" -> "Q3"
            "Quận 4" -> "Q4"
            "Quận 5" -> "Q5"
            "Quận 6" -> "Q6"
            "Quận 7" -> "Q7"
            "Quận 8" -> "Q8"
            "Quận 10" -> "Q10"
            "Quận 11" -> "Q11"
            "Quận 12" -> "Q12"
            "Bình Thạnh" -> "BT"
            "Gò Vấp" -> "GV"
            "Tân Bình" -> "TB"
            "Tân Phú" -> "TP"
            "Phú Nhuận" -> "PN"
            "Bình Tân" -> "BTN"
            "TP. Thủ Đức" -> "TD"
            "Nhà Bè" -> "NB"
            "Bình Chánh" -> "BC"
            "Hóc Môn" -> "HM"
            "Củ Chi" -> "CC"
            "Cần Giờ" -> "CG"
            else -> "FB"
        }

        var counter = 1
        while (true) {
            val code = "%s%02d".format(prefix, counter)
            if (!existingCodes.contains(code)) {
                return code
            }
            counter++
        }
    }

    /**
     * Bulk import parser: parses multiple lines of "Name | URL" or "URL"
     */
    fun parseBulkGroups(input: String, existingCodes: Set<String>): List<Pair<String, String>> {
        val result = mutableListOf<Pair<String, String>>()
        val lines = input.lines()
        for (line in lines) {
            val trimmed = line.trim()
            if (trimmed.isEmpty()) continue
            if (trimmed.contains("|")) {
                val parts = trimmed.split("|")
                val name = parts[0].trim()
                val url = parts[1].trim()
                if (url.contains("facebook.com") || url.startsWith("http")) {
                    result.add(name to url)
                }
            } else if (trimmed.contains("facebook.com")) {
                val slug = extractGroupIdOrSlug(trimmed)
                result.add("Nhóm $slug" to trimmed)
            }
        }
        return result
    }

    /**
     * Launch official Facebook App Composer for group:
     * 1. Copy caption to Clipboard
     * 2. Package photo URIs via FileProvider into ACTION_SEND_MULTIPLE
     * 3. Target official Facebook app with deep-link fallback
     */
    fun launchShareAssist(
        context: Context,
        caption: String,
        photoPaths: List<String>,
        groupUrl: String
    ) {
        // 1. Copy caption to clipboard
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("CHDV Post", caption)
        clipboard.setPrimaryClip(clip)
        Toast.makeText(context, "Đã copy nội dung bài đăng vào Clipboard!", Toast.LENGTH_SHORT).show()

        // 2. Prepare photo URIs
        val photoUris = ArrayList<Uri>()
        for (path in photoPaths) {
            val file = if (path.startsWith("file://")) File(Uri.parse(path).path ?: "") else File(path)
            if (file.exists()) {
                try {
                    val contentUri = FileProvider.getUriForFile(
                        context,
                        "${context.packageName}.fileprovider",
                        file
                    )
                    photoUris.add(contentUri)
                } catch (e: Exception) {
                    // Fallback to direct URI
                    photoUris.add(Uri.fromFile(file))
                }
            }
        }

        val groupIdOrSlug = extractGroupIdOrSlug(groupUrl)
        val fbAppUri = Uri.parse("fb://group/$groupIdOrSlug")
        val webUri = if (groupUrl.startsWith("http")) Uri.parse(groupUrl) else Uri.parse("https://www.facebook.com/groups/$groupIdOrSlug")

        // 3. Try to launch Facebook composer with photos
        val sendIntent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "image/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, photoUris)
            putExtra(Intent.EXTRA_TEXT, caption)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            `package` = "com.facebook.katana"
        }

        try {
            context.startActivity(sendIntent)
        } catch (e: Exception) {
            // If Facebook app not installed or fails, open group URL directly
            val viewIntent = Intent(Intent.ACTION_VIEW, fbAppUri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                context.startActivity(viewIntent)
            } catch (ex: Exception) {
                val webIntent = Intent(Intent.ACTION_VIEW, webUri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(webIntent)
            }
        }
    }
}
