package com.zalotofb.poster.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.zalotofb.poster.data.local.dao.*
import com.zalotofb.poster.data.local.entity.*

@Database(
    entities = [
        ListingEntity::class,
        ListingPhotoEntity::class,
        FbGroupEntity::class,
        PostLogEntity::class,
        LeadEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun listingDao(): ListingDao
    abstract fun listingPhotoDao(): ListingPhotoDao
    abstract fun fbGroupDao(): FbGroupDao
    abstract fun postLogDao(): PostLogDao
    abstract fun leadDao(): LeadDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "chdv_post_manager.db"
                ).fallbackToDestructiveMigration().build()
                INSTANCE = instance
                instance
            }
        }
    }
}
