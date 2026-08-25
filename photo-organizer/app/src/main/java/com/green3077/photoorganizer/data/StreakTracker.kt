package com.green3077.photoorganizer.data

import android.content.Context
import java.time.LocalDate

/**
 * "챌린지" 개념을 위한 연속 정리일수 기록. 하루에 한 번이라도 사진을 정리(삭제)하면
 * 그날의 스트릭이 올라간다.
 */
object StreakTracker {
    private const val PREFS_NAME = "streak_prefs"
    private const val KEY_LAST_DATE = "last_organized_date"
    private const val KEY_STREAK = "current_streak"

    fun recordOrganizedToday(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val today = LocalDate.now()
        val lastDate = prefs.getString(KEY_LAST_DATE, null)?.let { LocalDate.parse(it) }
        val newStreak = when (lastDate) {
            today -> prefs.getInt(KEY_STREAK, 1)
            today.minusDays(1) -> prefs.getInt(KEY_STREAK, 0) + 1
            else -> 1
        }
        prefs.edit()
            .putString(KEY_LAST_DATE, today.toString())
            .putInt(KEY_STREAK, newStreak)
            .apply()
    }

    fun currentStreak(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lastDate = prefs.getString(KEY_LAST_DATE, null)?.let { LocalDate.parse(it) } ?: return 0
        val today = LocalDate.now()
        return if (lastDate == today || lastDate == today.minusDays(1)) prefs.getInt(KEY_STREAK, 0) else 0
    }
}
