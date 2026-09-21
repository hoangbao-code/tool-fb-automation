package com.example.posthub.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.sqlite.db.SupportSQLiteDatabase
import com.example.posthub.data.local.dao.FbGroupDao
import com.example.posthub.data.local.dao.FieldDefDao
import com.example.posthub.data.local.dao.PostDao
import com.example.posthub.data.local.dao.PostLogDao
import com.example.posthub.data.local.dao.TemplateDao
import com.example.posthub.data.local.dao.WorkspaceDao
import com.example.posthub.data.local.entity.FbGroupEntity
import com.example.posthub.data.local.entity.FieldDefEntity
import com.example.posthub.data.local.entity.PostEntity
import com.example.posthub.data.local.entity.PostLogEntity
import com.example.posthub.data.local.entity.TemplateEntity
import com.example.posthub.data.local.entity.WorkspaceEntity
import com.example.posthub.domain.model.IfMissingPolicy
import com.example.posthub.domain.model.TemplateSelectionMode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Database(
    entities = [
        PostEntity::class,
        WorkspaceEntity::class,
        TemplateEntity::class,
        FieldDefEntity::class,
        FbGroupEntity::class,
        PostLogEntity::class,
        com.example.posthub.data.local.entity.GroupEntity::class
    ],
    version = 2,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {

    abstract fun postDao(): PostDao
    abstract fun workspaceDao(): WorkspaceDao
    abstract fun templateDao(): TemplateDao
    abstract fun fieldDefDao(): FieldDefDao
    abstract fun fbGroupDao(): FbGroupDao
    abstract fun postLogDao(): PostLogDao
    abstract fun groupDao(): com.example.posthub.data.local.dao.GroupDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "jammy_post_hub.db"
                )
                .fallbackToDestructiveMigration()
                .addCallback(object : Callback() {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        super.onCreate(db)
                        // Khởi tạo Workspace mặc định và các biến cơ bản trong background coroutine
                        CoroutineScope(Dispatchers.IO).launch {
                            val database = getInstance(context)
                            val wsId = database.workspaceDao().insertWorkspace(
                                WorkspaceEntity(name = "Cho thuê căn hộ/phòng", isDefault = true, tagsJson = "[\"chdv\", \"phongtro\"]")
                            )

                            // Các trường biến cơ bản phổ biến
                            database.fieldDefDao().insertFieldDef(
                                FieldDefEntity(workspaceId = wsId, key = "gia", displayName = "Giá thuê", extractRegex = """(?i)(\d+([\.,]\d+)?\s*(tr|triệu|k|tr\/tháng))""", ifMissing = IfMissingPolicy.KEEP_PLACEHOLDER)
                            )
                            database.fieldDefDao().insertFieldDef(
                                FieldDefEntity(workspaceId = wsId, key = "quan", displayName = "Quận / Khu vực", extractRegex = """(?i)(quận\s*\d+|q\.\s*\d+|bình thạnh|gò vấp|phú nhuận|tân bình|thủ đức|quận\s*[a-z]+)""", ifMissing = IfMissingPolicy.SKIP_LINE)
                            )
                            database.fieldDefDao().insertFieldDef(
                                FieldDefEntity(workspaceId = wsId, key = "sdt", displayName = "Số điện thoại liên hệ", extractRegex = """(0\d{9})""", ifMissing = IfMissingPolicy.ASK_ME)
                            )
                            database.fieldDefDao().insertFieldDef(
                                FieldDefEntity(workspaceId = wsId, key = "loai_phong", displayName = "Loại phòng", extractRegex = """(?i)(studio|1pn|2pn|duplex|gác lửng)""", ifMissing = IfMissingPolicy.SKIP_LINE)
                            )

                            // Template mẫu đầu tiên
                            database.templateDao().insertTemplate(
                                TemplateEntity(
                                    workspaceId = wsId,
                                    title = "Mẫu tin cho thuê chuẩn",
                                    content = "🏢 CHO THUÊ PHÒNG ĐẸP TẠI {quan}!\n\n✨ Loại phòng: {loai_phong}\n💰 Giá thuê: {gia}\n{?dien_tich}📐 Diện tích: {dien_tich}{/?}\n\n📞 Liên hệ xem phòng ngay: {sdt}\n(Inbox trực tiếp để nhận ảnh chi tiết)",
                                    selectionMode = TemplateSelectionMode.MANUAL
                                )
                            )
                        }
                    }
                })
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
