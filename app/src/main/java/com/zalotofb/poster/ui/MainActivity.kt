package com.zalotofb.poster.ui

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.zalotofb.poster.R
import com.zalotofb.poster.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupNavigation()

        val openListingId = intent.getStringExtra("OPEN_LISTING_ID")
        if (openListingId != null) {
            openPostSessionWithListing(openListingId)
        } else if (savedInstanceState == null) {
            switchTab(InventoryFragment())
        }
    }

    private fun setupNavigation() {
        binding.bottomNavigation.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_inventory -> {
                    switchTab(InventoryFragment())
                    true
                }
                R.id.nav_post -> {
                    switchTab(PostSessionFragment.newInstance(null))
                    true
                }
                R.id.nav_groups -> {
                    switchTab(GroupsFragment())
                    true
                }
                R.id.nav_stats -> {
                    switchTab(StatsFragment())
                    true
                }
                R.id.nav_settings -> {
                    switchTab(SettingsFragment())
                    true
                }
                else -> false
            }
        }
    }

    fun openPostSessionWithListing(listingId: String) {
        binding.bottomNavigation.selectedItemId = R.id.nav_post
        switchTab(PostSessionFragment.newInstance(listingId))
    }

    private fun switchTab(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragment_container, fragment)
            .commit()
    }
}
