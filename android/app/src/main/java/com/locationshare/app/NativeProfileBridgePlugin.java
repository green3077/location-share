package com.locationshare.app;

import android.content.Intent;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * app.js의 syncNativeProfile()이 profile 저장 때마다 호출하는 유일한 통로. localStorage
 * 값을 SharedPreferences(ProfileStore)에 미러링하고, sharingEnabled에 따라
 * BootLocationForegroundService를 시작/정지시킨다. 위치 권한이 아직 없으면 여기서 먼저
 * 요청하고, 승인된 뒤에야 서비스를 실제로 시작한다.
 *
 * ACCESS_BACKGROUND_LOCATION("항상 허용")은 여기서 연달아 요청하지 않는다 - 두 번째 권한 요청이
 * 기기별로 콜백 없이 걸려 서비스가 아예 시작되지 않는 문제가 있었다. 대신 공유를 시작한 뒤
 * 앱 화면(app.js)에서 따로 안내하고 BatteryOptimizationBridge.openAppSettings()로 설정 화면을
 * 연다. 이 권한이 없으면 시스템이 앱을 죽인 뒤 백그라운드에서 재시작된 서비스는 위치를 못
 * 받으므로(Android 11+) 신호가 끊기지 않으려면 꼭 필요하다.
 */
@CapacitorPlugin(
    name = "NativeProfileBridge",
    permissions = {
        @Permission(alias = "location", strings = { android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class NativeProfileBridgePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        boolean sharingEnabled = Boolean.TRUE.equals(call.getBoolean("sharingEnabled", false));
        String memberId = call.getString("memberId");
        String name = call.getString("name");
        String groupCode = call.getString("groupCode");
        String databaseURL = call.getString("databaseURL");

        ProfileStore.save(getContext(), sharingEnabled, memberId, name, groupCode, databaseURL);

        if (!sharingEnabled || memberId == null || groupCode == null || databaseURL == null) {
            stopSharing();
            call.resolve();
            return;
        }

        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onLocationPermissionResult");
            return;
        }
        beginSharing();
        call.resolve();
    }

    @PermissionCallback
    private void onLocationPermissionResult(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            // 위치 권한을 거부하면 공유를 켤 수 없다 - sharingEnabled를 되돌려 다음 재시작(재부팅/
            // 감시장치)때 권한 없는 서비스가 계속 재시도되는 걸 막는다.
            ProfileStore.save(getContext(), false, call.getString("memberId"), call.getString("name"),
                    call.getString("groupCode"), call.getString("databaseURL"));
            call.reject("Location permission denied");
            return;
        }
        beginSharing();
        call.resolve();
    }

    private void beginSharing() {
        // 앱 화면이 떠 있는 지금 시작해야 "앱 사용 중" 위치 권한만으로도 서비스가 위치를 받는다.
        LocationWatchdogReceiver.startTick(getContext());
    }

    private void stopSharing() {
        LocationWatchdog.cancel(getContext());
        getContext().stopService(new Intent(getContext(), BootLocationForegroundService.class));
    }
}
