package com.locationshare.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 신호가 끊기지 않기 위한 기기 설정 상태를 확인하고, 해당 설정 화면을 열어준다.
 * (이름은 v1.5 호환 때문에 그대로 둠 - 배터리 최적화 외에 v1.17부터 위치 "항상 허용",
 * 정확한 알람, 알림 표시 상태도 함께 다룬다.)
 */
@CapacitorPlugin(name = "BatteryOptimizationBridge")
public class BatteryOptimizationBridgePlugin extends Plugin {

    private boolean isIgnoring() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoring());
        call.resolve(ret);
    }

    @PluginMethod
    public void getReliabilityStatus(PluginCall call) {
        Context ctx = getContext();
        boolean fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                ? (fine || coarse)
                : ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean notifications = NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        JSObject ret = new JSObject();
        ret.put("locationGranted", fine || coarse);
        ret.put("preciseLocation", fine);
        ret.put("backgroundLocation", background);
        ret.put("batteryOptimizationIgnored", isIgnoring());
        ret.put("exactAlarms", LocationWatchdog.canUseExactAlarms(ctx));
        ret.put("notifications", notifications);
        ret.put("serviceRunning", BootLocationForegroundService.isRunning);
        ret.put("lastSentAt", ProfileStore.getLastSentAt(ctx));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestExemption(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("requestExemption failed", e);
        }
    }

    /** 앱 정보 화면 - 여기서 권한 > 위치 > "항상 허용"을 고를 수 있다. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("openAppSettings failed", e);
        }
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            }
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("openExactAlarmSettings failed", e);
        }
    }
}
