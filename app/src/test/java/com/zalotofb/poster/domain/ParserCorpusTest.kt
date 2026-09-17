package com.zalotofb.poster.domain

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import com.zalotofb.poster.domain.model.RoomType
import com.zalotofb.poster.domain.parser.ListingParser
import com.zalotofb.poster.domain.parser.fold1to1
import com.zalotofb.poster.domain.scrubber.ListingScrubber
import com.zalotofb.poster.domain.template.TemplateEngine
import org.junit.Assert.*
import org.junit.BeforeClass
import org.junit.Test
import java.io.InputStreamReader

data class CorpusCase(
    val id: Int,
    val description: String,
    val rawText: String,
    val expectedPriceMin: Long?,
    val expectedPriceMax: Long?,
    val expectedDistrict: String?,
    val expectedRoomType: String?,
    val expectedAreaM2: Double?,
    val expectedHasCommission: Boolean,
    val expectedOwnerPhone: String?,
    val expectedPhonesCount: Int?
)

class ParserCorpusTest {

    companion object {
        private lateinit var corpusList: List<CorpusCase>

        @BeforeClass
        @JvmStatic
        fun loadCorpus() {
            val stream = ParserCorpusTest::class.java.classLoader?.getResourceAsStream("corpus.json")
                ?: java.io.File("app/src/test/resources/corpus.json").inputStream()
            val reader = InputStreamReader(stream, Charsets.UTF_8)
            val type = object : TypeToken<List<CorpusCase>>() {}.type
            corpusList = Gson().fromJson(reader, type)
            assertTrue("Corpus must contain at least 30 cases", corpusList.size >= 30)
        }
    }

    @Test
    fun testFold1to1LengthInvariance() {
        for (case in corpusList) {
            val folded = case.rawText.fold1to1()
            assertEquals(
                "Fold1to1 must preserve exact length for case #${case.id}: ${case.description}",
                case.rawText.length,
                folded.length
            )
        }
    }

    @Test
    fun testCorpusParser100Percent() {
        val failedCases = mutableListOf<String>()

        for (case in corpusList) {
            try {
                val parsed = ListingParser.parse(case.rawText)

                // 1. Price check
                assertEquals(
                    "Case #${case.id} [${case.description}] priceMin mismatch",
                    case.expectedPriceMin,
                    parsed.priceMin
                )
                assertEquals(
                    "Case #${case.id} [${case.description}] priceMax mismatch",
                    case.expectedPriceMax,
                    parsed.priceMax
                )

                // 2. District check
                if (case.expectedDistrict != null) {
                    assertEquals(
                        "Case #${case.id} [${case.description}] district mismatch",
                        case.expectedDistrict,
                        parsed.district
                    )
                }

                // 3. Room type check
                if (case.expectedRoomType != null) {
                    assertEquals(
                        "Case #${case.id} [${case.description}] roomType mismatch",
                        RoomType.valueOf(case.expectedRoomType),
                        parsed.roomType
                    )
                } else if (case.id == 14) {
                    // Case 14 is a house sale, room type should be null
                    assertNull(
                        "Case #${case.id} [${case.description}] roomType should be null",
                        parsed.roomType
                    )
                }

                // 4. Area check
                if (case.expectedAreaM2 != null) {
                    assertEquals(
                        "Case #${case.id} [${case.description}] areaM2 mismatch",
                        case.expectedAreaM2,
                        parsed.areaM2
                    )
                }

                // 5. Owner phone check
                if (case.expectedOwnerPhone != null) {
                    assertEquals(
                        "Case #${case.id} [${case.description}] ownerPhone mismatch",
                        case.expectedOwnerPhone,
                        parsed.ownerPhone
                    )
                }
            } catch (e: Throwable) {
                failedCases.add("Case #${case.id} [${case.description}]: ${e.message}")
            }
        }

        if (failedCases.isNotEmpty()) {
            fail("Corpus test failed on ${failedCases.size} cases:\n" + failedCases.joinToString("\n"))
        }
    }

    @Test
    fun testCorpusScrubberAndSafety() {
        val failedCases = mutableListOf<String>()

        for (case in corpusList) {
            try {
                val scrubResult = ListingScrubber.scrub(case.rawText)

                // Absolute safety checks on cleanText:
                assertFalse(
                    "Case #${case.id} [${case.description}] cleanText still has commission!",
                    ListingScrubber.hasCommission(scrubResult.cleanText)
                )
                val remainingPhones = ListingScrubber.extractPhones(scrubResult.cleanText)
                assertTrue(
                    "Case #${case.id} [${case.description}] cleanText still has phones: $remainingPhones",
                    remainingPhones.isEmpty()
                )

                // Expected commission check
                val detectedComm = scrubResult.commissionNote != null ||
                        scrubResult.removedSpans.any { it.reason.contains("COMMISSION") }
                if (case.expectedHasCommission) {
                    assertTrue(
                        "Case #${case.id} [${case.description}] should have detected commission",
                        detectedComm
                    )
                } else {
                    assertFalse(
                        "Case #${case.id} [${case.description}] should NOT have detected commission (e.g. 100% nha moi)",
                        detectedComm
                    )
                }

                // Phone count check if specified
                if (case.expectedPhonesCount != null) {
                    val allPhones = ListingParser.extractPhones(case.rawText)
                    assertEquals(
                        "Case #${case.id} [${case.description}] phone count mismatch",
                        case.expectedPhonesCount,
                        allPhones.size
                    )
                }
            } catch (e: Throwable) {
                failedCases.add("Case #${case.id} [${case.description}]: ${e.message}")
            }
        }

        if (failedCases.isNotEmpty()) {
            fail("Scrubber test failed on ${failedCases.size} cases:\n" + failedCases.joinToString("\n"))
        }
    }

    @Test
    fun testTemplateEngineRenderingAndSafety() {
        for (case in corpusList) {
            val parsed = ListingParser.parse(case.rawText)
            val scrubResult = ListingScrubber.scrub(case.rawText)

            for (variant in 0..4) {
                val rendered = TemplateEngine.render(
                    listing = parsed,
                    cleanText = scrubResult.cleanText,
                    hotline = "0900000000",
                    signature = "Môi giới tận tâm",
                    trackingCode = "BT01",
                    variantIndex = variant
                )

                // Critical requirement: renderedText must NEVER contain owner phones or commission
                assertFalse(
                    "Case #${case.id} variant $variant rendered text has commission!",
                    ListingScrubber.hasCommission(rendered)
                )
                val phones = ListingScrubber.extractPhones(rendered)
                assertTrue(
                    "Case #${case.id} variant $variant rendered text contains unexpected phones: $phones",
                    phones.all { it == "0900000000" } // Only user's hotline allowed
                )

                // If price is null (e.g. case 9 or 14), price line MUST be dropped
                if (parsed.priceMin == null && parsed.priceMax == null) {
                    assertFalse(
                        "Case #${case.id} has no price, rendered text must not show empty price line",
                        rendered.contains("Giá thuê:")
                    )
                }
            }
        }
    }

    @Test
    fun testVariantsAreDifferent() {
        val case = corpusList.first()
        val parsed = ListingParser.parse(case.rawText)
        val scrub = ListingScrubber.scrub(case.rawText)

        val variants = (0..4).map {
            TemplateEngine.render(
                listing = parsed,
                cleanText = scrub.cleanText,
                hotline = "0900000000",
                trackingCode = "BT01",
                variantIndex = it
            )
        }

        val uniqueVariants = variants.toSet()
        assertEquals("TemplateEngine must generate distinct variants", 5, uniqueVariants.size)
    }
}
