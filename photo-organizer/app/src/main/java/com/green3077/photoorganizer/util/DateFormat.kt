package com.green3077.photoorganizer.util

import java.time.LocalDate
import java.time.MonthDay

object DateFormat {
    fun monthDayLabel(monthDay: MonthDay): String = "${monthDay.monthValue}월 ${monthDay.dayOfMonth}일"

    fun yearLabel(year: Int, today: LocalDate): String {
        val diff = today.year - year
        return if (diff <= 0) "${year}년" else "${year}년 · ${diff}년 전"
    }
}
