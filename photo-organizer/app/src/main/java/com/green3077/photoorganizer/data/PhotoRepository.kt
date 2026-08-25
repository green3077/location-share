package com.green3077.photoorganizer.data

import android.content.ContentUris
import android.content.Context
import android.provider.MediaStore
import com.green3077.photoorganizer.model.MemoryGroup
import com.green3077.photoorganizer.model.Photo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.MonthDay
import java.time.ZoneId

class PhotoRepository(private val context: Context) {

    suspend fun loadAllPhotos(): List<Photo> = withContext(Dispatchers.IO) {
        val photos = mutableListOf<Photo>()
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DISPLAY_NAME
        )
        val sortOrder = "${MediaStore.Images.Media.DATE_TAKEN} DESC"
        val zone = ZoneId.systemDefault()

        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            null,
            null,
            sortOrder
        )?.use { cursor ->
            val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val dateTakenCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
            val dateAddedCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val dateTakenMillis = cursor.getLong(dateTakenCol)
                val dateAddedSeconds = cursor.getLong(dateAddedCol)
                val millis = if (dateTakenMillis > 0) dateTakenMillis else dateAddedSeconds * 1000
                if (millis <= 0) continue

                val date = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
                val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
                photos.add(Photo(id, uri, date, nameCol.let { cursor.getString(it) } ?: ""))
            }
        }
        photos
    }

    /**
     * MonthDay가 2개 이상의 연도에 걸쳐 존재하는 그룹만 추림 ("매년 오늘" 후보).
     * today를 기준으로 다음 기념일까지 가장 가까운 순으로 정렬.
     */
    fun buildRecurringMemoryGroups(photos: List<Photo>, today: MonthDay): List<MemoryGroup> {
        return photos
            .groupBy { it.monthDay }
            .filterValues { group -> group.map { it.dateTaken.year }.distinct().size >= 2 }
            .map { (monthDay, group) ->
                MemoryGroup(monthDay, group.groupBy { it.dateTaken.year }.toSortedMap(compareByDescending { it }))
            }
            .sortedBy { daysUntilNextOccurrence(it.monthDay, today) }
    }

    fun photosForMonthDay(photos: List<Photo>, monthDay: MonthDay): Map<Int, List<Photo>> {
        return photos
            .filter { it.monthDay == monthDay }
            .groupBy { it.dateTaken.year }
            .toSortedMap(compareByDescending { it })
    }

    private fun daysUntilNextOccurrence(monthDay: MonthDay, today: MonthDay): Int {
        if (monthDay == today) return 0
        val todayValue = today.monthValue * 100 + today.dayOfMonth
        val targetValue = monthDay.monthValue * 100 + monthDay.dayOfMonth
        return if (targetValue > todayValue) targetValue - todayValue else targetValue - todayValue + 1231
    }
}
