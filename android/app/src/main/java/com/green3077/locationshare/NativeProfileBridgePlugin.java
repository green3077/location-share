package com.green3077.locationshare;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
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
 */
@CapacitorPlugin(
    name = "NativeProfileBridge",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
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
        proceedAfterForegroundPermission(call);
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
        proceedAfterForegroundPermission(call);
    }

    private void proceedAfterForegroundPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && getPermissionState("backgroundLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("backgroundLocation", call, "onBackgroundPermissionResult");
            return;
        }
        beginSharing();
        call.resolve();
    }

    @PermissionCallback
    private void onBackgroundPermissionResult(PluginCall call) {
        // 백그라운드 위치 권한이 거부돼도 서비스는 시작한다 - 포그라운드 서비스 알림이 떠 있는
        // 동안은 기기/버전에 따라 이 권한 없이도 위치가 계속 갱신되는 경우가 많기 때문이다.
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
