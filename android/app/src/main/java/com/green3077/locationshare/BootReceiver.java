package com.green3077.locationshare;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/**
 * 재부팅 직후 공유가 켜져 있던 사용자라면 자동으로 위치 공유를 재개한다. 이 시점엔 WebView/JS가
 * 아예 실행되지 않으므로 ProfileStore(SharedPreferences)에 미러링된 값만으로 판단해야 한다.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!ProfileStore.isSharingEnabled(context) || !ProfileStore.hasValidProfile(context)) return;
        ContextCompat.startForegroundService(context, new Intent(context, BootLocationForegroundService.class));
        LocationWatchdog.schedule(context);
    }
}
