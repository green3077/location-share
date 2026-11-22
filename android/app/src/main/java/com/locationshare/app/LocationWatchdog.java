package com.locationshare.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;

/**
 * 위치 공유의 3분 주기를 실제로 "깨워서" 돌리는 알람 (v1.17).
 *
 * v1.16의 감시 알람은 부정확한 알람(setAndAllowWhileIdle)이었는데, Android 12+에서는 부정확한
 * 알람으로 백그라운드에서 포그라운드 서비스를 다시 켜는 것이 금지돼 있어(배터리 최적화 제외
 * 앱만 예외) 서비스가 죽으면 되살리지 못했다. 정확한 알람(setExactAndAllowWhileIdle)은 이
 * 금지의 예외 대상이고, 화면이 꺼진 절전 상태에서도 CPU를 깨운다. USE_EXACT_ALARM 권한
 * (매니페스트)으로 Android 13+에서도 사용자 허용 없이 쓸 수 있다.
 */
final class LocationWatchdog {
    private static final int REQUEST_CODE = 9001;

    private LocationWatchdog() {}

    /** 하위 호환: 기존 호출부는 한 주기 뒤를 예약한다. */
    static void schedule(Context context) {
        scheduleNext(context, BootLocationForegroundService.UPDATE_INTERVAL_MS);
    }

    static void scheduleNext(Context context, long delayMs) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = pendingIntent(context);
        long triggerAt = SystemClock.elapsedRealtime() + delayMs;
        try {
            if (canUseExactAlarms(am)) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
            } else {
                am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
            }
        } catch (SecurityException e) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
            }
        }
    }

    static boolean canUseExactAlarms(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return am != null && canUseExactAlarms(am);
    }

    private static boolean canUseExactAlarms(AlarmManager am) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return am.canScheduleExactAlarms();
        return true;
    }

    static void cancel(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pendingIntent(context));
    }

    private static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, LocationWatchdogReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags);
    }
}
