package com.example.posthub.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileWriter
import java.io.PrintWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue

enum class LogLevel {
    DEBUG, INFO, WARN, ERROR
}

data class LogEntry(
    val timestamp: Long,
    val level: LogLevel,
    val tag: String,
    val message: String,
    val throwable: Throwable? = null
) {
    fun format(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
        val timeStr = sdf.format(Date(timestamp))
        val base = "$timeStr [${level.name}] [$tag] $message"
        return if (throwable != null) {
            val sw = java.io.StringWriter()
            val pw = PrintWriter(sw)
            throwable.printStackTrace(pw)
            "$base\n$sw"
        } else {
            base
        }
    }
}

object AppLog {
    private const val MAX_LOG_FILE_BYTES = 2 * 1024 * 1024L // 2MB
    private const val MAX_MEMORY_ENTRIES = 500

    private var logFile: File? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val memoryEntries = ConcurrentLinkedQueue<LogEntry>()

    private val _logFlow = MutableSharedFlow<LogEntry>(replay = 50, extraBufferCapacity = 100)
    val logFlow: SharedFlow<LogEntry> = _logFlow.asSharedFlow()

    @Synchronized
    fun init(context: Context) {
        if (logFile != null) return
        val logDir = File(context.filesDir, "logs")
        if (!logDir.exists()) {
            logDir.mkdirs()
        }
        logFile = File(logDir, "app.log")
        checkLogFileSize()
        i("AppLog", "Hệ thống ghi log khởi tạo thành công tại: ${logFile?.absolutePath}")
    }

    fun d(tag: String, message: String, throwable: Throwable? = null) {
        log(LogLevel.DEBUG, tag, message, throwable)
    }

    fun i(tag: String, message: String, throwable: Throwable? = null) {
        log(LogLevel.INFO, tag, message, throwable)
    }

    fun w(tag: String, message: String, throwable: Throwable? = null) {
        log(LogLevel.WARN, tag, message, throwable)
    }

    fun e(tag: String, message: String, throwable: Throwable? = null) {
        log(LogLevel.ERROR, tag, message, throwable)
    }

    private fun log(level: LogLevel, tag: String, message: String, throwable: Throwable?) {
        val entry = LogEntry(
            timestamp = System.currentTimeMillis(),
            level = level,
            tag = tag,
            message = message,
            throwable = throwable
        )

        // Android logcat output (if available)
        when (level) {
            LogLevel.DEBUG -> Log.d(tag, message, throwable)
            LogLevel.INFO -> Log.i(tag, message, throwable)
            LogLevel.WARN -> Log.w(tag, message, throwable)
            LogLevel.ERROR -> Log.e(tag, message, throwable)
        }

        // Memory buffer for instant UI viewing
        memoryEntries.add(entry)
        while (memoryEntries.size > MAX_MEMORY_ENTRIES) {
            memoryEntries.poll()
        }

        _logFlow.tryEmit(entry)

        // Write to file asynchronously
        scope.launch {
            writeToFile(entry)
        }
    }

    @Synchronized
    private fun writeToFile(entry: LogEntry) {
        val file = logFile ?: return
        try {
            checkLogFileSize()
            FileWriter(file, true).use { fw ->
                fw.write(entry.format() + "\n")
            }
        } catch (e: Exception) {
            Log.e("AppLog", "Lỗi ghi log ra file", e)
        }
    }

    private fun checkLogFileSize() {
        val file = logFile ?: return
        if (file.exists() && file.length() > MAX_LOG_FILE_BYTES) {
            val backupFile = File(file.parentFile, "app.log.old")
            if (backupFile.exists()) {
                backupFile.delete()
            }
            file.renameTo(backupFile)
            file.createNewFile()
        }
    }

    fun getRecentLogs(): List<LogEntry> {
        return memoryEntries.toList()
    }

    fun readAllLogsFromFile(): String {
        val file = logFile ?: return memoryEntries.joinToString("\n") { it.format() }
        return try {
            if (file.exists()) {
                file.readText()
            } else {
                memoryEntries.joinToString("\n") { it.format() }
            }
        } catch (e: Exception) {
            "Lỗi khi đọc file log: ${e.message}"
        }
    }

    @Synchronized
    fun clearLogs() {
        memoryEntries.clear()
        val file = logFile
        if (file != null && file.exists()) {
            file.writeText("")
        }
        i("AppLog", "Đã xóa toàn bộ nhật ký.")
    }

    fun getLogFile(): File? = logFile
}
