package com.example.posthub.scanner

object SuggestionHelper {
    private val AREA_KEYWORDS = mapOf(
        "Hà Nội" to listOf("hà nội", "hn", "cầu giấy", "nam từ liêm", "bắc từ liêm", "thanh xuân", "hoàng mai", "đống đa", "ba đình", "hà đông", "long biên"),
        "TP.HCM" to listOf("hồ chí minh", "tphcm", "sài gòn", "sg", "thủ đức", "quận 1", "quận 2", "quận 7", "quận 9", "bình thạnh", "gò vấp", "tân bình", "bình tân"),
        "Đà Nẵng" to listOf("đà nẵng", "sơn trà", "hải châu", "ngũ hành sơn", "liên chiểu"),
        "Bình Dương" to listOf("bình dương", "thủ dầu một", "dĩ an", "thuận an", "bến cát"),
        "Đồng Nai" to listOf("đồng nai", "biên hòa", "long thành", "nhơn trạch")
    )

    private val CATEGORY_KEYWORDS = mapOf(
        "Bất Động Sản" to listOf("nhà đất", "bđs", "căn hộ", "chung cư", "phòng trọ", "cho thuê", "mặt bằng", "đất nền", "nhà phố", "homestay"),
        "Việc Làm" to listOf("tuyển dụng", "việc làm", "tìm việc", "freelance", "part-time", "fulltime", "part time", "thực tập", "nhân viên"),
        "Thanh Lý / Mua Bán" to listOf("chợ", "thanh lý", "mua bán", "pass đồ", "rao vặt", "đồ cũ", "xe máy", "điện thoại"),
        "Cộng Đồng" to listOf("cư dân", "hội đồng hương", "giao lưu", "hội những người", "câu lạc bộ", "clb")
    )

    fun suggestCategory(name: String): String? {
        val lower = name.lowercase()
        return CATEGORY_KEYWORDS.entries.firstOrNull { (_, keywords) ->
            keywords.any { lower.contains(it) }
        }?.key
    }

    fun suggestArea(name: String): String? {
        val lower = name.lowercase()
        return AREA_KEYWORDS.entries.firstOrNull { (_, keywords) ->
            keywords.any { lower.contains(it) }
        }?.key
    }
}
