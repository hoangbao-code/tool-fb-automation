package com.example.posthub.scanner

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.posthub.JammyApp
import com.example.posthub.data.local.entity.GroupEntity
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.io.File

data class GroupUiFilterState(
    val platform: String = "fb",
    val searchQuery: String = "",
    val selectedCategory: String? = null,
    val selectedArea: String? = null
)

class GroupScannerViewModel(app: Application) : AndroidViewModel(app) {
    private val container = JammyApp.instance.container
    private val dao = container.database.groupDao()
    val scannerEngine = container.groupScannerEngine

    private val _filterState = MutableStateFlow(GroupUiFilterState())
    val filterState = _filterState.asStateFlow()

    val scannerState = scannerEngine.state

    val groups = _filterState.flatMapLatest { filter ->
        dao.observeGroups(
            platform = filter.platform,
            searchQuery = filter.searchQuery.ifBlank { null },
            category = filter.selectedCategory,
            area = filter.selectedArea
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val categories = _filterState.flatMapLatest { filter ->
        dao.getCategoriesFlow(filter.platform)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val areas = _filterState.flatMapLatest { filter ->
        dao.getAreasFlow(filter.platform)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun setPlatform(platform: String) {
        _filterState.update { it.copy(platform = platform, searchQuery = "", selectedCategory = null, selectedArea = null) }
    }

    fun setSearchQuery(query: String) {
        _filterState.update { it.copy(searchQuery = query) }
    }

    fun setCategory(category: String?) {
        _filterState.update { it.copy(selectedCategory = category) }
    }

    fun setArea(area: String?) {
        _filterState.update { it.copy(selectedArea = area) }
    }

    fun toggleGroup(group: GroupEntity) {
        viewModelScope.launch {
            dao.updateEnabled(group.id, !group.enabled)
        }
    }

    fun toggleAll(enabled: Boolean) {
        viewModelScope.launch {
            dao.updateAllEnabled(_filterState.value.platform, enabled)
        }
    }

    fun updateMetadata(groupId: Long, category: String?, area: String?, priority: Int) {
        viewModelScope.launch {
            dao.updateMetadata(groupId, category?.ifBlank { null }, area?.ifBlank { null }, priority)
        }
    }

    fun deleteGroup(groupId: Long) {
        viewModelScope.launch {
            dao.deleteGroupById(groupId)
        }
    }

    fun startSync(enrichDetails: Boolean = false) {
        scannerEngine.startScan(_filterState.value.platform, enrichDetails)
    }

    fun stopSync() {
        scannerEngine.stopScan()
    }

    fun exportToCsv(file: File) {
        viewModelScope.launch {
            val list = dao.getActiveGroupsByPlatform(_filterState.value.platform)
            val csvHeader = "ID,Platform,Name,MemberCount,Category,Area,Enabled,Priority,Rules,CanPost,NeedApproval\n"
            val content = list.joinToString("\n") {
                "\"${it.externalId}\",\"${it.platform}\",\"${it.name.replace("\"", "\"\"")}\",\"${it.memberCount ?: ""}\",\"${it.category ?: ""}\",\"${it.area ?: ""}\",${it.enabled},${it.priority},\"${(it.rules ?: "").replace("\"", "\"\"")}\",${it.canPost},${it.needApproval}"
            }
            file.writeText(csvHeader + content)
        }
    }
}
