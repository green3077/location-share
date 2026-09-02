package com.green3077.locationshare;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * 순수 네이티브 위치 공유 서비스 - WebView/JS와 무관하게 동작하며, 화면이 꺼지거나 앱이
 * 백그라운드로 가거나 프로세스가 재시작돼도(START_STICKY + LocationWatchdog의 AlarmManager
 * 이중 감시) 계속 위치를 보고한다. 2026-08-17: 예전엔 JS의 background-geolocation 워처에
 * 의존했는데 프로세스가 죽으면 복구가 안 됐던 문제(신호 끊김의 실제 원인)를 이 방식으로 해소했다.
 *
 * app.js의 UPDATE_INTERVAL_MS(3분) / LOCATION_HISTORY_INTERVAL_MS(10분)와 항상 같은 값을
 * 유지할 것 - 웹(포그라운드 탭)과 네이티브(백그라운드) 양쪽이 같은 주기로 기록해야 "지난 위치
 * 기록"이 사용자에게 일관되게 보인다.
 */
public class BootLocationForegroundService extends Service {

    private static final String CHANNEL_ID = "location_sharing_channel";
    private static final int NOTIFICATION_ID = 1001;

    private static final long UPDATE_INTERVAL_MS = 3 * 60 * 1000L;
    private static final long LOCATION_HISTORY_INTERVAL_MS = 10 * 60 * 1000L;
    private static final long LOCATION_TIMEOUT_MS = 20 * 1000L;

    static volatile boolean isRunning = false;

    private HandlerThread workerThread;
    private Handler workerHandler;
    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private LocationListener pendingListener;
    private final Runnable tick = this::requestLocationOnce;

    @Override
    public void onCreate() {
        super.onCreate();
        // API 34+에서는 foregroundServiceType="location"인 서비스가 startForeground()를 부르는
        // 시점에 위치 권한이 하나도 없으면 SecurityException으로 죽는다. 이 서비스는 보통 권한이
        // 확인된 뒤(NativeProfileBridgePlugin)에만 시작되지만, 재부팅/감시장치 경로는 그 확인을
        // 거치지 않으므로(권한이 그 사이 취소됐을 수도 있음) 여기서 한 번 더 방어한다.
        boolean hasFine = ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarse = ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!hasFine && !hasCoarse) {
            stopSelf();
            return;
        }
        isRunning = true;
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        workerThread = new HandlerThread("LocationShareWorker");
        workerThread.start();
        workerHandler = new Handler(workerThread.getLooper());
        LocationWatchdog.schedule(getApplicationContext());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (workerHandler == null) {
            // onCreate()에서 권한 부족 등으로 이미 stopSelf()한 경우 - 아무 것도 하지 않는다.
            return START_NOT_STICKY;
        }
        if (!ProfileStore.isSharingEnabled(getApplicationContext()) || !ProfileStore.hasValidProfile(getApplicationContext())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        workerHandler.removeCallbacks(tick);
        workerHandler.post(tick);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        if (workerHandler != null) {
            workerHandler.removeCallbacksAndMessages(null);
        }
        removePendingLocationRequest();
        if (workerThread != null) workerThread.quitSafely();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void requestLocationOnce() {
        if (!ProfileStore.isSharingEnabled(getApplicationContext())) {
            stopSelf();
            return;
        }
        // 이번 위치 획득이 실패/지연되어도 3분 주기 자체는 끊기지 않도록 다음 tick을 먼저 예약한다.
        workerHandler.postDelayed(tick, UPDATE_INTERVAL_MS);

        boolean hasFine = ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarse = ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!hasFine && !hasCoarse) return;
        if (locationManager == null) return;

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LocationShare:fix");
            wakeLock.acquire(LOCATION_TIMEOUT_MS + 5000);
        }

        removePendingLocationRequest();
        pendingListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                removePendingLocationRequest();
                onLocationResolved(location);
            }
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
        };

        // GPS_PROVIDER는 ACCESS_FINE_LOCATION이 있어야만 쓸 수 있다 - "대략적 위치"만 허용한
        // 사용자는 FINE이 없으므로 GPS 요청 하나만 걸면 매번 SecurityException으로 실패해
        // 위치가 영원히 안 올라간다. 권한이 허용하는 provider 전부에 동시에 걸어서 먼저
        // 응답하는 쪽을 쓴다 - 하나가 없거나 비활성화돼도 나머지로 계속 동작한다.
        boolean requested = false;
        if (hasFine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            requested |= requestFrom(LocationManager.GPS_PROVIDER);
        }
        if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            requested |= requestFrom(LocationManager.NETWORK_PROVIDER);
        }
        if (!requested) {
            // 활성화된 provider가 하나도 없다(위치 서비스 자체가 꺼짐 등) - 그래도 최근에 알려진
            // 위치가 있으면 그거라도 보고해서 "완전히 끊김"은 피한다.
            reportLastKnownLocationIfAny(hasFine);
            releaseWakeLock();
            return;
        }
        workerHandler.postDelayed(() -> {
            if (pendingListener == null) return; // 이미 응답 받아 처리됨
            removePendingLocationRequest();
            reportLastKnownLocationIfAny(hasFine);
        }, LOCATION_TIMEOUT_MS);
    }

    private boolean requestFrom(String provider) {
        try {
            locationManager.requestSingleUpdate(provider, pendingListener, workerHandler.getLooper());
            return true;
        } catch (SecurityException | IllegalArgumentException e) {
            return false;
        }
    }

    // 정해진 시간 안에 새 위치를 못 받았을 때, provider에 남아있는 마지막 위치라도 있으면
    // 그걸 대신 보고한다 - 완전히 새 신호는 아니지만, 사용자 입장에선 "끊김"보다 훨씬 낫다.
    private void reportLastKnownLocationIfAny(boolean hasFine) {
        if (locationManager == null) return;
        Location best = null;
        try {
            if (hasFine) {
                Location gps = safeLastKnown(LocationManager.GPS_PROVIDER);
                if (gps != null) best = gps;
            }
            Location network = safeLastKnown(LocationManager.NETWORK_PROVIDER);
            if (network != null && (best == null || network.getTime() > best.getTime())) best = network;
        } catch (SecurityException ignored) {}
        if (best != null) onLocationResolved(best);
    }

    private Location safeLastKnown(String provider) {
        try {
            return locationManager.getLastKnownLocation(provider);
        } catch (SecurityException | IllegalArgumentException e) {
            return null;
        }
    }

    private void removePendingLocationRequest() {
        if (pendingListener != null && locationManager != null) {
            try {
                locationManager.removeUpdates(pendingListener);
            } catch (Exception ignored) {}
        }
        pendingListener = null;
        releaseWakeLock();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void onLocationResolved(Location location) {
        Context context = getApplicationContext();
        String memberId = ProfileStore.getMemberId(context);
        String groupCode = ProfileStore.getGroupCode(context);
        String databaseURL = ProfileStore.getDatabaseURL(context);
        String name = ProfileStore.getName(context);
        if (memberId == null || groupCode == null || databaseURL == null) return;

        double lat = location.getLatitude();
        double lng = location.getLongitude();
        float accuracy = location.getAccuracy();

        writeCurrentLocation(databaseURL, groupCode, memberId, name, lat, lng, accuracy);
        maybeWriteHistory(databaseURL, groupCode, memberId, lat, lng, accuracy);
    }

    // writeLocation()과 동일한 REST 엔드포인트/스키마 - members/{memberId}는 매번 덮어쓴다.
    private void writeCurrentLocation(String databaseURL, String groupCode, String memberId, String name, double lat, double lng, float accuracy) {
        try {
            String url = databaseURL + "/groups/" + encode(groupCode) + "/members/" + encode(memberId) + ".json";
            JSONObject body = new JSONObject();
            body.put("name", name);
            body.put("lat", lat);
            body.put("lng", lng);
            body.put("accuracy", accuracy);
            JSONObject serverTs = new JSONObject();
            serverTs.put(".sv", "timestamp");
            body.put("updatedAt", serverTs);
            httpRequest(url, "PUT", body.toString());
        } catch (Exception ignored) {
            // 다음 3분 주기에 다시 시도되므로 여기서는 조용히 무시한다.
        }
    }

    // maybeWriteLocationHistory()와 동일하게, LOCATION_HISTORY_INTERVAL_MS마다 한 번씩만
    // history 노드에 POST(덮어쓰지 않고 쌓임)한다. SharedPreferences에 마지막 기록 시각을
    // 별도 보관한다(웹 전용 localStorage 스로틀과는 다른 저장소 - 주석 참고).
    private void maybeWriteHistory(String databaseURL, String groupCode, String memberId, double lat, double lng, float accuracy) {
        Context context = getApplicationContext();
        long last = ProfileStore.getLastHistoryWriteAt(context);
        long now = System.currentTimeMillis();
        if (now - last < LOCATION_HISTORY_INTERVAL_MS) return;
        try {
            String url = databaseURL + "/groups/" + encode(groupCode) + "/members/" + encode(memberId) + "/history.json";
            JSONObject body = new JSONObject();
            body.put("lat", lat);
            body.put("lng", lng);
            body.put("accuracy", accuracy);
            JSONObject serverTs = new JSONObject();
            serverTs.put(".sv", "timestamp");
            body.put("ts", serverTs);
            int status = httpRequest(url, "POST", body.toString());
            if (status >= 200 && status < 300) {
                ProfileStore.setLastHistoryWriteAt(context, now);
            }
        } catch (Exception ignored) {}
    }

    private static String encode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private static int httpRequest(String urlStr, String method, String body) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            return conn.getResponseCode();
        } finally {
            conn.disconnect();
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "위치 공유", NotificationManager.IMPORTANCE_MIN);
            channel.setShowBadge(false);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = launchIntent == null ? null : PendingIntent.getActivity(
                this, 0, launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("위치 공유 중")
                .setContentText("친구들에게 내 위치를 공유하고 있습니다.")
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_MIN);
        if (contentIntent != null) builder.setContentIntent(contentIntent);
        return builder.build();
    }
}
