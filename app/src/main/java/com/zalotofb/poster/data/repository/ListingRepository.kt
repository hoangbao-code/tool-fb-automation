package com.zalotofb.poster.data.repository

import com.zalotofb.poster.data.local.AppDatabase
import com.zalotofb.poster.data.local.PreferenceStorage
import com.zalotofb.poster.data.local.entity.ListingEntity
import com.zalotofb.poster.data.local.entity.ListingPhotoEntity
import com.zalotofb.poster.domain.model.ListingStatus
import com.zalotofb.poster.domain.model.Source
import com.zalotofb.poster.domain.parser.ListingParser
import com.zalotofb.poster.domain.parser.fold1to1
import com.zalotofb.poster.domain.scrubber.ListingScrubber
import com.zalotofb.poster.domain.template.TemplateEngine
import kotlinx.coroutines.flow.Flow
import java.security.MessageDigest
import java.util.UUID

data class DuplicateCheckResult(
    val exactDuplicate: ListingEntity?,
    val potentialDuplicate: ListingEntity?
)

class ListingRepository(
    private val db: AppDatabase,
    private val prefs: PreferenceStorage
) {
    private val listingDao = db.listingDao()
    private val photoDao = db.listingPhotoDao()

    fun observeAll(): Flow<List<ListingEntity>> = listingDao.observeAll()

    fun observeByStatus(status: ListingStatus): Flow<List<ListingEntity>> =
        listingDao.observeByStatus(status)

    fun observeById(id: String): Flow<ListingEntity?> = listingDao.observeById(id)

    suspend fun getById(id: String): ListingEntity? = listingDao.getById(id)

    fun observePhotos(listingId: String): Flow<List<ListingPhotoEntity>> =
        photoDao.observePhotosForListing(listingId)

    suspend fun computeContentHash(rawText: String): String {
        val folded = rawText.fold1to1()
        // Strip phones
        val phones = ListingParser.extractPhones(rawText)
        var noPhone = folded
        for (p in phones) {
            noPhone = noPhone.replace(p, "")
        }
        // Keep only letters and digits
        val alphanumericOnly = noPhone.filter { it.isLetterOrDigit() }
        val digest = MessageDigest.getInstance("SHA-256")
        val hashBytes = digest.digest(alphanumericOnly.toByteArray(Charsets.UTF_8))
        return hashBytes.joinToString("") { "%02x".format(it) }
    }

    suspend fun checkDuplicates(
        rawText: String,
        priceMin: Long?,
        areaM2: Double?,
        district: String?
    ): DuplicateCheckResult {
        val hash = computeContentHash(rawText)
        val exact = listingDao.findByContentHash(hash)
        val potential = if (exact == null && priceMin != null && areaM2 != null && district != null) {
            listingDao.findPotentialDuplicate(priceMin, areaM2, district)
        } else null
        return DuplicateCheckResult(exact, potential)
    }

    suspend fun ingestRawListing(
        rawText: String,
        source: Source,
        sourceGroup: String? = null
    ): ListingEntity {
        val now = System.currentTimeMillis()
        val contentHash = computeContentHash(rawText)

        val parsed = ListingParser.parse(rawText)
        val scrubResult = ListingScrubber.scrub(rawText)

        val template = prefs.customTemplate ?: TemplateEngine.DEFAULT_TEMPLATE
        val rendered = TemplateEngine.render(
            template = template,
            listing = parsed,
            cleanText = scrubResult.cleanText,
            hotline = prefs.hotline,
            signature = prefs.signature,
            variantIndex = 0
        )

        // Parse confidence < 0.6 -> DRAFT
        val initialStatus = if (parsed.parseConfidence >= 0.6f && !ListingScrubber.hasCommission(rendered) && ListingScrubber.extractPhones(rendered).all { it == prefs.hotline }) {
            ListingStatus.READY
        } else {
            ListingStatus.DRAFT
        }

        val entity = ListingEntity(
            id = UUID.randomUUID().toString(),
            rawText = rawText,
            cleanText = scrubResult.cleanText,
            renderedText = rendered,
            source = source,
            sourceGroup = sourceGroup,
            contentHash = contentHash,
            priceMin = parsed.priceMin,
            priceMax = parsed.priceMax,
            areaM2 = parsed.areaM2,
            district = parsed.district,
            roomType = parsed.roomType,
            address = parsed.address,
            status = initialStatus,
            ownerPhone = scrubResult.ownerPhone ?: parsed.ownerPhone,
            commissionNote = scrubResult.commissionNote,
            parseConfidence = parsed.parseConfidence,
            createdAt = now,
            updatedAt = now
        )

        listingDao.insert(entity)
        return entity
    }

    suspend fun updateListing(listing: ListingEntity) {
        listingDao.update(listing.copy(updatedAt = System.currentTimeMillis()))
    }

    suspend fun deleteListing(listing: ListingEntity) {
        photoDao.deleteByListingId(listing.id)
        listingDao.delete(listing)
    }

    suspend fun markRented(listingId: String): Int {
        val listing = listingDao.getById(listingId) ?: return 0
        listingDao.update(
            listing.copy(
                status = ListingStatus.RENTED,
                updatedAt = System.currentTimeMillis()
            )
        )
        return db.postLogDao().countPostsForListing(listingId)
    }

    suspend fun addPhotos(listingId: String, uris: List<String>) {
        val existing = photoDao.getPhotosForListing(listingId)
        val startOrder = existing.size
        val entities = uris.mapIndexed { index, uri ->
            ListingPhotoEntity(
                id = UUID.randomUUID().toString(),
                listingId = listingId,
                uri = uri,
                order = startOrder + index,
                isCover = existing.isEmpty() && index == 0
            )
        }
        photoDao.insertAll(entities)
    }

    suspend fun checkStaleListed(): List<ListingEntity> {
        val fourteenDaysAgo = System.currentTimeMillis() - (14L * 24 * 60 * 60 * 1000)
        return listingDao.getStaleListed(fourteenDaysAgo)
    }
}
