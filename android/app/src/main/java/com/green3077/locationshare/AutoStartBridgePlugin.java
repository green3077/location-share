package com.green3077.locationshare;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 삼성/샤오미/화웨이 등 제조사별 "자동 실행 허용" 설정 화면을 직접 연다(v1.16). 기기마다
 * 화면 컴포넌트가 없거나 막혀 있을 수 있으므로 실패하면 앱 상세 설정으로 대체한다.
 */
@CapacitorPlugin(name = "AutoStartBridge")
public class AutoStartBridgePlugin extends Plugin {

    @PluginMethod
    public void openAutoStartSettings(PluginCall call) {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        ComponentName component = null;
        switch (manufacturer) {
            case "xiaomi":
                component = new ComponentName("com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity");
                break;
            case "oppo":
                component = new ComponentName("com.coloros.safecenter",
                        "com.coloros.safecenter.permission.startup.StartupAppListActivity");
                break;
            case "vivo":
                component = new ComponentName("com.vivo.permissionmanager",
                        "com.vivo.permissionmanager.activity.BgStartUpManagerActivity");
                break;
            case "huawei":
                component = new ComponentName("com.huawei.systemmanager",
                        "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity");
                break;
            case "samsung":
                component = new ComponentName("com.samsung.android.lool",
                        "com.samsung.android.sm.ui.battery.BatteryActivity");
                break;
            default:
                break;
        }

        if (component != null) {
            try {
                Intent intent = new Intent();
                intent.setComponent(component);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
                return;
            } catch (ActivityNotFoundException | SecurityException ignored) {
                // 이 기기/펌웨어 버전엔 해당 화면이 없다 - 아래 앱 상세 설정으로 대체한다.
            }
        }

        Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(fallback);
        call.resolve();
    }
}
