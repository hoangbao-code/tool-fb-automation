package com.zalotofb.poster.data.local.dao

import androidx.room.*
import com.zalotofb.poster.data.local.entity.*
import com.zalotofb.poster.domain.model.ListingStatus
import kotlinx.coroutines.flow.Flow

@Dao
interface ListingDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(listing: ListingEntity)

    @Update
    suspend fun update(listing: ListingEntity)

    @Delete
    suspend fun delete(listing: ListingEntity)

    @Query("SELECT * FROM listings WHERE id = :id")
    suspend fun getById(id: String): ListingEntity?

    @Query("SELECT * FROM listings WHERE id = :id")
    fun observeById(id: String): Flow<ListingEntity?>

    @Query("SELECT * FROM listings ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<ListingEntity>>

    @Query("SELECT * FROM listings WHERE status = :status ORDER BY updatedAt DESC")
    fun observeByStatus(status: ListingStatus): Flow<List<ListingEntity>>

    @Query("SELECT * FROM listings WHERE contentHash = :hash LIMIT 1")
    suspend fun findByContentHash(hash: String): ListingEntity?

    @Query("""
        SELECT * FROM listings 
        WHERE status != 'RENTED' 
          AND priceMin = :price 
          AND areaM2 = :area 
          AND district = :district 
        LIMIT 1
    """)
    suspend fun findPotentialDuplicate(price: Long?, area: Double?, district: String?): ListingEntity?

    @Query("SELECT * FROM listings WHERE status = 'LISTED' AND updatedAt < :cutoffTime")
    suspend fun getStaleListed(cutoffTime: Long): List<ListingEntity>

    @Query("SELECT COUNT(*) FROM listings WHERE status = :status")
    fun observeCountByStatus(status: ListingStatus): Flow<Int>
}

@Dao
interface ListingPhotoDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(photos: List<ListingPhotoEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(photo: ListingPhotoEntity)

    @Delete
    suspend fun delete(photo: ListingPhotoEntity)

    @Query("DELETE FROM listing_photos WHERE listingId = :listingId")
    suspend fun deleteByListingId(listingId: String)

    @Query("SELECT * FROM listing_photos WHERE listingId = :listingId ORDER BY `order` ASC")
    fun observePhotosForListing(listingId: String): Flow<List<ListingPhotoEntity>>

    @Query("SELECT * FROM listing_photos WHERE listingId = :listingId ORDER BY `order` ASC")
    suspend fun getPhotosForListing(listingId: String): List<ListingPhotoEntity>
}

@Dao
interface FbGroupDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(group: FbGroupEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(groups: List<FbGroupEntity>)

    @Update
    suspend fun update(group: FbGroupEntity)

    @Delete
    suspend fun delete(group: FbGroupEntity)

    @Query("SELECT * FROM fb_groups WHERE id = :id")
    suspend fun getById(id: String): FbGroupEntity?

    @Query("SELECT * FROM fb_groups ORDER BY name ASC")
    fun observeAll(): Flow<List<FbGroupEntity>>

    @Query("SELECT * FROM fb_groups WHERE isActive = 1 ORDER BY name ASC")
    fun observeActive(): Flow<List<FbGroupEntity>>

    @Query("SELECT * FROM fb_groups WHERE url = :url LIMIT 1")
    suspend fun findByUrl(url: String): FbGroupEntity?

    @Query("SELECT COUNT(*) FROM fb_groups")
    suspend fun count(): Int
}

@Dao
interface PostLogDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(log: PostLogEntity)

    @Update
    suspend fun update(log: PostLogEntity)

    @Query("SELECT * FROM post_logs WHERE listingId = :listingId ORDER BY postedAt DESC")
    fun observeByListing(listingId: String): Flow<List<PostLogEntity>>

    @Query("SELECT * FROM post_logs ORDER BY postedAt DESC")
    fun observeAll(): Flow<List<PostLogEntity>>

    @Query("SELECT COUNT(*) FROM post_logs WHERE groupId = :groupId AND postedAt >= :startOfDay")
    suspend fun countPostsTodayForGroup(groupId: String, startOfDay: Long): Int

    @Query("SELECT COUNT(*) FROM post_logs WHERE listingId = :listingId")
    suspend fun countPostsForListing(listingId: String): Int
}

@Dao
interface LeadDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(lead: LeadEntity)

    @Query("SELECT * FROM leads ORDER BY createdAt DESC")
    fun observeAll(): Flow<List<LeadEntity>>

    @Query("SELECT * FROM leads WHERE listingId = :listingId ORDER BY createdAt DESC")
    fun observeByListing(listingId: String): Flow<List<LeadEntity>>

    @Query("SELECT * FROM leads WHERE groupId = :groupId ORDER BY createdAt DESC")
    fun observeByGroup(groupId: String): Flow<List<LeadEntity>>

    @Query("SELECT COUNT(*) FROM leads WHERE groupId = :groupId")
    suspend fun countLeadsForGroup(groupId: String): Int
}
