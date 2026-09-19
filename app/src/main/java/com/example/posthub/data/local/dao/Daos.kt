package com.example.posthub.data.local.dao

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.example.posthub.data.local.entity.FbGroupEntity
import com.example.posthub.data.local.entity.FieldDefEntity
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
}
