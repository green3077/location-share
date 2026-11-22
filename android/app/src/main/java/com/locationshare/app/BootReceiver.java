package com.locationshare.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 재부팅 직후 / 앱 업데이트 직후 공유가 켜져 있던 사용자라면 자동으로 위치 공유를 재개한다.
 * 이 시점엔 WebView/JS가 실행되지 않으므로 ProfileStore(SharedPreferences) 값만으로 판단한다.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)
                && !"com.htc.intent.action.QUICKBOOT_POWERON".equals(action)) return;
        if (!ProfileStore.isSharingEnabled(context) || !ProfileStore.hasValidProfile(context)) return;
        LocationWatchdogReceiver.startTick(context);
    }
}
