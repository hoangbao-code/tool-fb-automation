package com.example.posthub.domain.model

enum class PostStatus {
    PENDING_REVIEW,
    APPROVED,
    QUEUED,
    POSTING,
    POSTED,
    FAILED,
    REJECTED
}

enum class PostSource {
    SHARE_TARGET,
    NOTIFICATION,
    CLIPBOARD,
    MANUAL,
    ZALO_WEB
}

enum class IfMissingPolicy {
    SKIP_LINE,
    KEEP_PLACEHOLDER,
    ASK_ME
}

enum class TemplateSelectionMode {
    MANUAL,
    ROTATE,
    RANDOM
}

enum class JoinStatus {
    NOT_JOINED,
    REQUESTED,
    NEED_ANSWERS,
    JOINED,
    DECLINED,
    BANNED,
    LEFT
}

data class Post(
    val id: Long = 0,
    val rawText: String,
    val cleanedText: String = "",
    val finalPostText: String = "",
    val photoPaths: List<String> = emptyList(),
    val source: PostSource = PostSource.MANUAL,
    val senderOrGroup: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val status: PostStatus = PostStatus.PENDING_REVIEW,
    val targetGroupIds: List<Long> = emptyList(),
    val workspaceId: Long = 1L,
    val templateId: Long? = null,
    val textHash: Long = 0L,
    val imageHashes: List<Long> = emptyList(),
    val errorMessage: String? = null
)

data class Workspace(
    val id: Long = 0,
    val name: String,
    val isDefault: Boolean = false,
    val tags: List<String> = emptyList()
)

data class FieldDef(
    val id: Long = 0,
    val workspaceId: Long,
    val key: String, // e.g. "gia", "quan", "sdt"
    val displayName: String = "",
    val extractRegex: String? = null,
    val fixedValue: String? = null,
    val ifMissing: IfMissingPolicy = IfMissingPolicy.SKIP_LINE
)

data class Template(
    val id: Long = 0,
    val workspaceId: Long,
    val title: String,
    val content: String,
    val selectionMode: TemplateSelectionMode = TemplateSelectionMode.MANUAL
)

data class FbGroup(
    val id: Long = 0,
    val name: String,
    val url: String,
    val memberCount: Int = 0,
    val joinStatus: JoinStatus = JoinStatus.NOT_JOINED,
    val rulesNote: String = "",
    val maxPostsPerDay: Int = 3,
    val activeHoursStart: Int = 8,
    val activeHoursEnd: Int = 22,
    val tags: List<String> = emptyList(),
    val lastError: String? = null,
    val lastPostedAt: Long? = null
)
