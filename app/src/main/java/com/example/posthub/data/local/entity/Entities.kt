package com.example.posthub.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.example.posthub.domain.model.IfMissingPolicy
import com.example.posthub.domain.model.JoinStatus
import com.example.posthub.domain.model.PostSource
import com.example.posthub.domain.model.PostStatus
import com.example.posthub.domain.model.TemplateSelectionMode

@Entity(tableName = "posts")
data class PostEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val rawText: String,
    val cleanedText: String = "",
    val finalPostText: String = "",
    val photoPathsJson: String = "[]",
    val source: PostSource = PostSource.MANUAL,
    val senderOrGroup: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val status: PostStatus = PostStatus.PENDING_REVIEW,
    val targetGroupIdsJson: String = "[]",
    val workspaceId: Long = 1L,
    val templateId: Long? = null,
    val textHash: Long = 0L,
    val imageHashesJson: String = "[]",
    val errorMessage: String? = null
)

@Entity(tableName = "workspaces")
data class WorkspaceEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val name: String,
    val isDefault: Boolean = false,
    val tagsJson: String = "[]"
)

@Entity(tableName = "field_defs")
data class FieldDefEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val workspaceId: Long,
    val key: String,
    val displayName: String = "",
    val extractRegex: String? = null,
    val fixedValue: String? = null,
    val ifMissing: IfMissingPolicy = IfMissingPolicy.SKIP_LINE
)

@Entity(tableName = "templates")
data class TemplateEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val workspaceId: Long,
    val title: String,
    val content: String,
    val selectionMode: TemplateSelectionMode = TemplateSelectionMode.MANUAL
)

@Entity(tableName = "fb_groups")
data class FbGroupEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val name: String,
    val url: String,
    val memberCount: Int = 0,
    val joinStatus: JoinStatus = JoinStatus.NOT_JOINED,
    val rulesNote: String = "",
    val maxPostsPerDay: Int = 3,
    val activeHoursStart: Int = 8,
    val activeHoursEnd: Int = 22,
    val tagsJson: String = "[]",
    val lastError: String? = null,
    val lastPostedAt: Long? = null
)

@Entity(tableName = "post_logs")
data class PostLogEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val postId: Long,
    val groupId: Long,
    val groupName: String,
    val timestamp: Long = System.currentTimeMillis(),
    val status: String, // "SUCCESS", "FAILED", "CHECKPOINT"
    val mode: String, // "ASSISTED", "AUTO"
    val errorMessage: String? = null
)

@Entity(
    tableName = "unified_groups",
    indices = [androidx.room.Index(value = ["platform", "externalId"], unique = true)]
)
data class GroupEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val platform: String,           // "fb" | "zalo"
    val externalId: String,         // Group ID on FB or Zalo
    val name: String,
    val memberCount: String? = null,
    val category: String? = null,
    val area: String? = null,
    val rules: String? = null,
    val canPost: Boolean = true,
    val needApproval: Boolean = false,
    val enabled: Boolean = true,
    val priority: Int = 0,          // 0: Normal, 1: High, 2: Very high
    val lastSynced: Long = System.currentTimeMillis(),
    val lastPosted: Long? = null,
    val isLeft: Boolean = false     // Đánh dấu nhóm người dùng đã rời, không xóa
)
