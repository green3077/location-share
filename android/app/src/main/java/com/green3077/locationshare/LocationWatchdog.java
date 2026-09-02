package com.green3077.locationshare;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;

/**
 * BootLocationForegroundService가 제조사 배터리 관리자 등에 의해 죽어도 5분 안에 스스로
 * 재시작시키는 감시장치(v1.16, version.json 참고). START_STICKY만으로는 재시작이 지연되거나
 * 아예 막히는 기기가 있어 별도 AlarmManager 타이머로 이중 안전장치를 둔다.
 */
final class LocationWatchdog {
    private static final long INTERVAL_MS = 5 * 60 * 1000L;
    private static final int REQUEST_CODE = 9001;

    private LocationWatchdog() {}

    static void schedule(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = pendingIntent(context);
        long triggerAt = SystemClock.elapsedRealtime() + INTERVAL_MS;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
        } else {
            am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi);
        }
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
