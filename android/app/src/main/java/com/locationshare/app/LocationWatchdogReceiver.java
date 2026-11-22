package com.locationshare.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/**
 * LocationWatchdog 알람이 울릴 때마다(3분) 서비스에 "한 번 보내라(TICK)"를 전달한다. 서비스가
 * 죽어 있었다면 이 호출이 그대로 다시 살린다. 시작이 거부되면(드문 제조사 제한) 잠시 뒤 재시도.
 */
public class LocationWatchdogReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ProfileStore.isSharingEnabled(context) || !ProfileStore.hasValidProfile(context)) {
            LocationWatchdog.cancel(context);
            return;
        }
        startTick(context);
    }

    static void startTick(Context context) {
        Intent service = new Intent(context, BootLocationForegroundService.class);
        service.setAction(BootLocationForegroundService.ACTION_TICK);
        try {
            ContextCompat.startForegroundService(context, service);
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException 등 - 사슬이 끊기지 않게 1분 뒤 다시 시도.
            LocationWatchdog.scheduleNext(context, 60 * 1000L);
        }
    }
}
