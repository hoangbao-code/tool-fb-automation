package com.zalotofb.poster.data.models

import java.io.Serializable

data class FacebookGroup(
    val id: String,
    val name: String,
    var districtTag: String = "Toàn Thành Phố",
    var isSelected: Boolean = true,
    val memberCount: Int = 0,
    val isPrivacyPublic: Boolean = true
) : Serializable
