package com.example.posthub.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import com.example.posthub.data.local.entity.FbGroupEntity
import com.example.posthub.data.local.entity.FieldDefEntity
import com.example.posthub.data.local.entity.GroupEntity
import com.example.posthub.data.local.entity.PostEntity
import com.example.posthub.data.local.entity.PostLogEntity
import com.example.posthub.data.local.entity.TemplateEntity
import com.example.posthub.data.local.entity.WorkspaceEntity
import com.example.posthub.domain.model.PostStatus
import kotlinx.coroutines.flow.Flow

@Dao
interface PostDao {
    @Query("SELECT * FROM posts ORDER BY createdAt DESC")
    fun getAllPostsFlow(): Flow<List<PostEntity>>

    @Query("SELECT * FROM posts WHERE status = :status ORDER BY createdAt DESC")
    fun getPostsByStatusFlow(status: PostStatus): Flow<List<PostEntity>>

    @Query("SELECT * FROM posts WHERE id = :id")
    suspend fun getPostById(id: Long): PostEntity?

    @Query("SELECT * FROM posts WHERE textHash = :hash LIMIT 1")
    suspend fun findPostByHash(hash: Long): PostEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPost(post: PostEntity): Long

    @Update
    suspend fun updatePost(post: PostEntity)

    @Delete
    suspend fun deletePost(post: PostEntity)

    @Query("DELETE FROM posts WHERE id = :id")
    suspend fun deletePostById(id: Long)

    @Query("DELETE FROM posts WHERE status = 'POSTED' AND createdAt < :beforeTimestamp")
    suspend fun deleteOldPostedPosts(beforeTimestamp: Long): Int

    @Query("DELETE FROM posts WHERE status = 'POSTED'")
    suspend fun deleteAllPostedPosts(): Int
}

@Dao
interface WorkspaceDao {
    @Query("SELECT * FROM workspaces ORDER BY id ASC")
    fun getAllWorkspacesFlow(): Flow<List<WorkspaceEntity>>

    @Query("SELECT * FROM workspaces WHERE id = :id")
    suspend fun getWorkspaceById(id: Long): WorkspaceEntity?

    @Query("SELECT * FROM workspaces WHERE isDefault = 1 LIMIT 1")
    suspend fun getDefaultWorkspace(): WorkspaceEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWorkspace(workspace: WorkspaceEntity): Long

    @Update
    suspend fun updateWorkspace(workspace: WorkspaceEntity)

    @Delete
    suspend fun deleteWorkspace(workspace: WorkspaceEntity)
}

@Dao
interface TemplateDao {
    @Query("SELECT * FROM templates WHERE workspaceId = :workspaceId")
    fun getTemplatesForWorkspaceFlow(workspaceId: Long): Flow<List<TemplateEntity>>

    @Query("SELECT * FROM templates WHERE workspaceId = :workspaceId")
    suspend fun getTemplatesForWorkspace(workspaceId: Long): List<TemplateEntity>

    @Query("SELECT * FROM templates WHERE id = :id")
    suspend fun getTemplateById(id: Long): TemplateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTemplate(template: TemplateEntity): Long

    @Update
    suspend fun updateTemplate(template: TemplateEntity)

    @Delete
    suspend fun deleteTemplate(template: TemplateEntity)
}

@Dao
interface FieldDefDao {
    @Query("SELECT * FROM field_defs WHERE workspaceId = :workspaceId")
    fun getFieldDefsForWorkspaceFlow(workspaceId: Long): Flow<List<FieldDefEntity>>

    @Query("SELECT * FROM field_defs WHERE workspaceId = :workspaceId")
    suspend fun getFieldDefsForWorkspace(workspaceId: Long): List<FieldDefEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFieldDef(fieldDef: FieldDefEntity): Long

    @Update
    suspend fun updateFieldDef(fieldDef: FieldDefEntity)

    @Delete
    suspend fun deleteFieldDef(fieldDef: FieldDefEntity)
}

@Dao
interface FbGroupDao {
    @Query("SELECT * FROM fb_groups ORDER BY name ASC")
    fun getAllGroupsFlow(): Flow<List<FbGroupEntity>>

    @Query("SELECT * FROM fb_groups WHERE id = :id")
    suspend fun getGroupById(id: Long): FbGroupEntity?

    @Query("SELECT * FROM fb_groups WHERE url = :url LIMIT 1")
    suspend fun getGroupByUrl(url: String): FbGroupEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertGroup(group: FbGroupEntity): Long

    @Update
    suspend fun updateGroup(group: FbGroupEntity)

    @Delete
    suspend fun deleteGroup(group: FbGroupEntity)
}

@Dao
interface PostLogDao {
    @Query("SELECT * FROM post_logs ORDER BY timestamp DESC LIMIT 100")
    fun getRecentLogsFlow(): Flow<List<PostLogEntity>>

    @Query("SELECT COUNT(*) FROM post_logs WHERE timestamp >= :sinceTimestamp AND status = 'SUCCESS'")
    suspend fun getSuccessfulPostCountSince(sinceTimestamp: Long): Int

    @Query("SELECT COUNT(*) FROM post_logs WHERE groupId = :groupId AND timestamp >= :sinceTimestamp AND status = 'SUCCESS'")
    suspend fun getSuccessfulPostCountForGroupSince(groupId: Long, sinceTimestamp: Long): Int

    @Insert
    suspend fun insertLog(log: PostLogEntity): Long

    @Query("DELETE FROM post_logs WHERE timestamp < :beforeTimestamp")
    suspend fun deleteOldLogs(beforeTimestamp: Long): Int
}

@Dao
interface GroupDao {
    @Query("""
        SELECT * FROM unified_groups 
        WHERE platform = :platform 
          AND (:searchQuery IS NULL OR name LIKE '%' || :searchQuery || '%')
          AND (:category IS NULL OR category = :category)
          AND (:area IS NULL OR area = :area)
        ORDER BY priority DESC, name ASC
    """)
    fun observeGroups(
        platform: String,
        searchQuery: String?,
        category: String?,
        area: String?
    ): Flow<List<GroupEntity>>

    @Query("SELECT * FROM unified_groups WHERE platform = :platform")
    fun getAllGroupsByPlatformFlow(platform: String): Flow<List<GroupEntity>>

    @Query("SELECT * FROM unified_groups WHERE platform = :platform AND isLeft = 0")
    suspend fun getActiveGroupsByPlatform(platform: String): List<GroupEntity>

    @Query("SELECT DISTINCT category FROM unified_groups WHERE platform = :platform AND category IS NOT NULL AND category != ''")
    fun getCategoriesFlow(platform: String): Flow<List<String>>

    @Query("SELECT DISTINCT area FROM unified_groups WHERE platform = :platform AND area IS NOT NULL AND area != ''")
    fun getAreasFlow(platform: String): Flow<List<String>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertGroup(group: GroupEntity): Long

    @Transaction
    suspend fun syncGroupsUpsert(platform: String, incomingList: List<GroupEntity>) {
        val existingGroups = getActiveGroupsByPlatform(platform).associateBy { it.externalId }
        val incomingIds = incomingList.map { it.externalId }.toSet()

        // 1. Upsert các nhóm mới hoặc cập nhật thông tin
        for (item in incomingList) {
            val existing = existingGroups[item.externalId]
            if (existing != null) {
                upsertGroup(
                    item.copy(
                        id = existing.id,
                        category = existing.category ?: item.category,
                        area = existing.area ?: item.area,
                        enabled = existing.enabled,
                        priority = existing.priority,
                        lastPosted = existing.lastPosted,
                        rules = existing.rules ?: item.rules,
                        canPost = if (item.canPost) item.canPost else existing.canPost,
                        needApproval = if (item.needApproval) item.needApproval else existing.needApproval,
                        isLeft = false
                    )
                )
            } else {
                upsertGroup(item.copy(isLeft = false))
            }
        }

        // 2. Nhóm không còn xuất hiện trong lần quét này -> đánh dấu "đã rời", không xóa
        for ((extId, group) in existingGroups) {
            if (extId !in incomingIds) {
                upsertGroup(group.copy(isLeft = true, lastSynced = System.currentTimeMillis()))
            }
        }
    }

    @Query("UPDATE unified_groups SET enabled = :enabled WHERE id = :id")
    suspend fun updateEnabled(id: Long, enabled: Boolean)

    @Query("UPDATE unified_groups SET enabled = :enabled WHERE platform = :platform")
    suspend fun updateAllEnabled(platform: String, enabled: Boolean)

    @Query("UPDATE unified_groups SET category = :category, area = :area, priority = :priority WHERE id = :id")
    suspend fun updateMetadata(id: Long, category: String?, area: String?, priority: Int)

    @Query("DELETE FROM unified_groups WHERE id = :id")
    suspend fun deleteGroupById(id: Long)
}
