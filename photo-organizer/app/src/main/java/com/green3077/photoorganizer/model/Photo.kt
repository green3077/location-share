package com.green3077.photoorganizer.model

import android.net.Uri
import java.time.LocalDate
import java.time.MonthDay

data class Photo(
    val id: Long,
    val uri: Uri,
    val dateTaken: LocalDate,
    val displayName: String
) {
    val monthDay: MonthDay get() = MonthDay.from(dateTaken)
}

data class MemoryGroup(
    val monthDay: MonthDay,
    val photosByYear: Map<Int, List<Photo>>
) {
    val yearCount: Int get() = photosByYear.size
    val photoCount: Int get() = photosByYear.values.sumOf { it.size }
    val coverPhoto: Photo get() = photosByYear.entries.maxBy { it.key }.value.first()
}
