package com.example.posthub.ui.screens

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Queue
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.example.posthub.JammyApp
import com.example.posthub.data.AppLog
import com.example.posthub.data.local.entity.FbGroupEntity
import com.example.posthub.data.local.entity.FieldDefEntity
import com.example.posthub.data.local.entity.PostEntity
import com.example.posthub.data.local.entity.TemplateEntity
import com.example.posthub.domain.extractor.FieldExtractor
import com.example.posthub.domain.model.FieldDef
import com.example.posthub.domain.model.PostStatus
import com.example.posthub.domain.model.Template
import com.example.posthub.domain.template.TemplateEngine
import com.example.posthub.domain.template.TemplatePicker
import com.example.posthub.work.PostWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewScreen(
    postId: Long,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = JammyApp.instance.container.database
    val converters = JammyApp.instance.container.converters

    var post by remember { mutableStateOf<PostEntity?>(null) }
    var rawText by remember { mutableStateOf("") }
    var finalPostText by remember { mutableStateOf("") }
    val extractedVariables = remember { mutableStateMapOf<String, String>() }

    val fieldDefsEntities by db.fieldDefDao().getFieldDefsForWorkspaceFlow(1L).collectAsState(initial = emptyList())
    val templatesEntities by db.templateDao().getTemplatesForWorkspaceFlow(1L).collectAsState(initial = emptyList())
    val allGroups by db.fbGroupDao().getAllGroupsFlow().collectAsState(initial = emptyList())

    val selectedGroupIds = remember { mutableStateMapOf<Long, Boolean>() }
    var selectedTemplateId by remember { mutableStateOf<Long?>(null) }
    var isAssistedMode by remember { mutableStateOf(true) }

    // Load bài đăng từ Database
    LaunchedEffect(postId) {
        val loaded = withContext(Dispatchers.IO) { db.postDao().getPostById(postId) }
        if (loaded != null) {
            post = loaded
            rawText = loaded.rawText
            finalPostText = loaded.finalPostText.ifBlank { loaded.rawText }
            selectedTemplateId = loaded.templateId

            // Nạp các nhóm đã chọn trước đó
            val savedGroupIds = converters.toLongList(loaded.targetGroupIdsJson)
            savedGroupIds.forEach { selectedGroupIds[it] = true }
        }
    }

    // Tự động trích xuất biến khi có danh sách FieldDef
    LaunchedEffect(fieldDefsEntities, rawText) {
        if (fieldDefsEntities.isNotEmpty() && rawText.isNotBlank()) {
            val domainDefs = fieldDefsEntities.map {
                FieldDef(id = it.id, workspaceId = it.workspaceId, key = it.key, displayName = it.displayName, extractRegex = it.extractRegex, fixedValue = it.fixedValue, ifMissing = it.ifMissing)
            }
            val extracted = FieldExtractor.extractFields(rawText, domainDefs)
            extracted.forEach { (k, v) ->
                if (!extractedVariables.containsKey(k)) {
                    extractedVariables[k] = v
                }
            }

            // Nếu có template, áp dụng render template luôn
            val currentTemplate = templatesEntities.find { it.id == selectedTemplateId } ?: templatesEntities.firstOrNull()
            if (currentTemplate != null) {
                selectedTemplateId = currentTemplate.id
                finalPostText = TemplateEngine.render(currentTemplate.content, extractedVariables, domainDefs)
            }
        }
    }

    fun applyTemplate(template: TemplateEntity) {
        selectedTemplateId = template.id
        val domainDefs = fieldDefsEntities.map {
            FieldDef(id = it.id, workspaceId = it.workspaceId, key = it.key, displayName = it.displayName, extractRegex = it.extractRegex, fixedValue = it.fixedValue, ifMissing = it.ifMissing)
        }
        finalPostText = TemplateEngine.render(template.content, extractedVariables, domainDefs)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Duyệt tin #${postId}") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Quay lại")
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            // Tự động xoay vòng mẫu (Rotate)
                            val domainTemplates = templatesEntities.map {
                                Template(id = it.id, workspaceId = it.workspaceId, title = it.title, content = it.content, selectionMode = it.selectionMode)
                            }
                            val picked = TemplatePicker.pickTemplate(domainTemplates, mode = com.example.posthub.domain.model.TemplateSelectionMode.ROTATE)
                            if (picked != null) {
                                val tmplEntity = templatesEntities.find { it.id == picked.id }
                                if (tmplEntity != null) {
                                    applyTemplate(tmplEntity)
                                    Toast.makeText(context, "Đã đổi sang mẫu: ${picked.title}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                    ) {
                        Icon(Icons.Default.AutoAwesome, contentDescription = "Đổi mẫu tự động")
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Phần 1: Các biến trích xuất (Variables Editor)
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "Biến trích xuất từ tin ({gia}, {quan}, {sdt}...)",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))

                    if (fieldDefsEntities.isEmpty()) {
                        Text("Chưa có biến nào. Hãy vào Cài đặt để thêm biến.", style = MaterialTheme.typography.bodySmall)
                    } else {
                        fieldDefsEntities.forEach { def ->
                            val currentVal = extractedVariables[def.key] ?: ""
                            OutlinedTextField(
                                value = currentVal,
                                onValueChange = { newVal ->
                                    extractedVariables[def.key] = newVal
                                    // Render lại template với biến mới
                                    val currentTemplate = templatesEntities.find { it.id == selectedTemplateId }
                                    if (currentTemplate != null) {
                                        val domainDefs = fieldDefsEntities.map {
                                            FieldDef(id = it.id, workspaceId = it.workspaceId, key = it.key, displayName = it.displayName, extractRegex = it.extractRegex, fixedValue = it.fixedValue, ifMissing = it.ifMissing)
                                        }
                                        finalPostText = TemplateEngine.render(currentTemplate.content, extractedVariables, domainDefs)
                                    }
                                },
                                label = { Text("${def.displayName.ifBlank { def.key }} {${def.key}}") },
                                modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                                singleLine = true
                            )
                        }
                    }
                }
            }

            // Phần 2: Chọn mẫu bài viết (Templates)
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "Chọn mẫu tin đăng (Template)",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))

                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(templatesEntities) { tmpl ->
                            FilterChip(
                                selected = selectedTemplateId == tmpl.id,
                                onClick = { applyTemplate(tmpl) },
                                label = { Text(tmpl.title) }
                            )
                        }
                    }
                }
            }

            // Phần 3: Nội dung bài viết cuối cùng (Final Preview)
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = "Nội dung bài viết sẽ đăng lên Facebook",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = finalPostText,
                        onValueChange = { finalPostText = it },
                        modifier = Modifier.fillMaxWidth().height(180.dp),
                        textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Default)
                    )
                }
            }

            // Phần 4: Chọn nhóm Facebook đăng bài
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Nhóm Facebook nhận bài (${selectedGroupIds.filterValues { it }.size})",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                        Icon(Icons.Default.Groups, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    }
                    Spacer(modifier = Modifier.height(8.dp))

                    if (allGroups.isEmpty()) {
                        Text(
                            text = "Chưa có nhóm nào. Hãy vào tab 'Nhóm' để dán link thêm nhóm!",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline
                        )
                    } else {
                        allGroups.forEach { group ->
                            val isChecked = selectedGroupIds[group.id] ?: false
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { selectedGroupIds[group.id] = !isChecked }
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Checkbox(
                                    checked = isChecked,
                                    onCheckedChange = { selectedGroupIds[group.id] = it }
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Column {
                                    Text(text = group.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text(text = group.url, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                                }
                            }
                        }
                    }
                }
            }

            // Phần 5: Chế độ đăng & Hành động
            ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = if (isAssistedMode) "Chế độ: TRỢ LỰC (ASSISTED)" else "Chế độ: TỰ ĐỘNG (AUTO)",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = if (isAssistedMode) "Mở WebView, điền sẵn bài, bạn tự bấm Đăng (An toàn 100%)" else "Tự động điền và bấm đăng qua rào chắn an toàn Jitter",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        Switch(
                            checked = isAssistedMode,
                            onCheckedChange = { isAssistedMode = it }
                        )
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Nút Đăng ngay
                    Button(
                        onClick = {
                            val pickedGroupIds = selectedGroupIds.filterValues { it }.keys.toList()
                            if (pickedGroupIds.isEmpty()) {
                                Toast.makeText(context, "Vui lòng chọn ít nhất 1 nhóm Facebook!", Toast.LENGTH_SHORT).show()
                                return@Button
                            }

                            scope.launch {
                                // Cập nhật bài đăng trong Room DB
                                val targetArray = JSONArray()
                                pickedGroupIds.forEach { targetArray.put(it) }

                                val updatedPost = post?.copy(
                                    finalPostText = finalPostText,
                                    templateId = selectedTemplateId,
                                    targetGroupIdsJson = targetArray.toString(),
                                    status = PostStatus.QUEUED
                                )
                                if (updatedPost != null) {
                                    withContext(Dispatchers.IO) { db.postDao().updatePost(updatedPost) }
                                }

                                // Kích hoạt Worker đăng bài
                                val workRequest = OneTimeWorkRequestBuilder<PostWorker>()
                                    .setInputData(
                                        workDataOf(
                                            PostWorker.KEY_POST_ID to postId,
                                            PostWorker.KEY_IS_ASSISTED to isAssistedMode
                                        )
                                    )
                                    .build()

                                WorkManager.getInstance(context).enqueue(workRequest)
                                Toast.makeText(context, "Đã đưa bài viết vào hàng đợi đăng bài!", Toast.LENGTH_SHORT).show()
                                onBack()
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Send, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(if (isAssistedMode) "Mở Đăng Trợ Lực Ngay" else "Kích Hoạt Đăng Tự Động")
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    // Nút Lưu nháp
                    OutlinedButton(
                        onClick = {
                            scope.launch(Dispatchers.IO) {
                                val targetArray = JSONArray()
                                selectedGroupIds.filterValues { it }.keys.forEach { targetArray.put(it) }

                                val updatedPost = post?.copy(
                                    finalPostText = finalPostText,
                                    templateId = selectedTemplateId,
                                    targetGroupIdsJson = targetArray.toString(),
                                    status = PostStatus.APPROVED
                                )
                                if (updatedPost != null) {
                                    db.postDao().updatePost(updatedPost)
                                }
                                withContext(Dispatchers.Main) {
                                    Toast.makeText(context, "Đã lưu bản duyệt thành công!", Toast.LENGTH_SHORT).show()
                                    onBack()
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Lưu Bản Duyệt (Chưa đăng)")
                    }
                }
            }
        }
    }
}
