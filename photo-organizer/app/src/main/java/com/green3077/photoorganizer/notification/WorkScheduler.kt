package com.green3077.photoorganizer.notification

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.time.Duration
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.concurrent.TimeUnit

object WorkScheduler {
    private const val WORK_NAME = "daily_memory_challenge"
    private val NOTIFY_TIME: LocalTime = LocalTime.of(9, 0)

    fun scheduleDaily(context: Context) {
        val request = PeriodicWorkRequestBuilder<DailyMemoryWorker>(Duration.ofDays(1))
            .setInitialDelay(computeInitialDelayMillis(), TimeUnit.MILLISECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    private fun computeInitialDelayMillis(): Long {
        val now = LocalDateTime.now()
        var next = now.toLocalDate().atTime(NOTIFY_TIME)
        if (!next.isAfter(now)) next = next.plusDays(1)
        return Duration.between(now, next).toMillis()
    }
}
