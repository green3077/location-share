package com.green3077.locationshare;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

public class LocationWatchdogReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ProfileStore.isSharingEnabled(context) || !ProfileStore.hasValidProfile(context)) {
            return;
        }
        if (!BootLocationForegroundService.isRunning) {
            ContextCompat.startForegroundService(context, new Intent(context, BootLocationForegroundService.class));
        }
        LocationWatchdog.schedule(context);
    }
}
