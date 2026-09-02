package com.green3077.locationshare;

import android.content.Intent;
import androidx.core.content.ContextCompat;
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
 * ACCESS_BACKGROUND_LOCATION은 일부러 요청하지 않는다 - foregroundServiceType="location"으로
 * 선언된 포그라운드 서비스(알림이 떠 있는 동안)는 안드로이드가 이미 "포그라운드"로 취급해서
 * 이 권한 없이도 위치를 계속 받을 수 있다. 예전엔 이 권한까지 별도 다이얼로그로 요청했는데,
 * 기기별로 이 두 번째 요청이 조용히 걸리거나 실패하면서 아예 서비스가 시작되지 않는(친구
 * 전원이 "신호 없음"으로 뜨는) 원인이었을 가능성이 높아 제거했다.
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
        Intent serviceIntent = new Intent(getContext(), BootLocationForegroundService.class);
        ContextCompat.startForegroundService(getContext(), serviceIntent);
        LocationWatchdog.schedule(getContext());
    }

    private void stopSharing() {
        LocationWatchdog.cancel(getContext());
        getContext().stopService(new Intent(getContext(), BootLocationForegroundService.class));
    }
}
