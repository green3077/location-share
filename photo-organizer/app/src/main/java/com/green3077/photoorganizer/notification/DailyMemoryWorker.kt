package com.green3077.photoorganizer.notification

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.green3077.photoorganizer.data.PhotoRepository
import java.time.LocalDate
import java.time.MonthDay

class DailyMemoryWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val repository = PhotoRepository(applicationContext)
        val today = MonthDay.now()
        val allPhotos = repository.loadAllPhotos()
        val pastYearPhotos = repository.photosForMonthDay(allPhotos, today)
            .filterKeys { it != LocalDate.now().year }

        if (pastYearPhotos.isNotEmpty()) {
            val totalCount = pastYearPhotos.values.sumOf { it.size }
            NotificationHelper.showDailyChallenge(applicationContext, today, pastYearPhotos.size, totalCount)
        }
        return Result.success()
    }
}
