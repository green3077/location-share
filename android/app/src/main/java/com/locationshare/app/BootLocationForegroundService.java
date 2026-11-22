package com.locationshare.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 순수 네이티브 위치 공유 서비스 (v1.17에서 신호 끊김 원인들을 정리해 다시 작성).
 *
 * v1.16까지 신호가 끊기던 원인과 여기서의 대응:
 *  1) 3분 주기를 Handler/위치 콜백에만 맡겼는데, 화면이 꺼져 CPU가 잠들면 그 타이머가 멈춘다.
 *     -> 주기 자체를 정확한 알람(LocationWatchdog, setExactAndAllowWhileIdle)이 깨워서 돌리고,
 *        위치 확보+전송 동안에만 짧은 WakeLock을 잡는다.
 *  2) 감시 알람이 "부정확한" 알람이라 Android 12+에서는 그 알람으로 서비스를 다시 켜는 것
 *     자체가 금지됐다(배터리 최적화 제외 앱만 예외). -> 정확한 알람(USE_EXACT_ALARM)은 예외 대상.
 *  3) 백그라운드에서 재시작된 위치 서비스는 "항상 허용" 권한이 없으면 위치를 못 받는다
 *     (Android 11+). -> 매니페스트에 ACCESS_BACKGROUND_LOCATION 추가, 앱 화면에서 안내.
 *  4) 새 위치를 못 받으면 아무것도 안 보내서 친구 화면에 회색으로 떴다.
 *     -> 새 위치가 없어도 마지막 위치로 "살아있음" 신호(updatedAt)를 매 주기 보낸다.
 *  5) 전송이 한 번 실패하면 다음 주기까지 그냥 버렸다. -> 같은 WakeLock 안에서 몇 번 재시도.
 *
 * app.js의 UPDATE_INTERVAL_MS(3분) / LOCATION_HISTORY_INTERVAL_MS(20분)와 같은 값을 유지할 것.
 */
public class BootLocationForegroundService extends Service {

    static final String ACTION_TICK = "com.locationshare.app.action.TICK";

    private static final String CHANNEL_ID = "location_sharing_channel";
    private static final int NOTIFICATION_ID = 1001;

    static final long UPDATE_INTERVAL_MS = 3 * 60 * 1000L;
    private static final long LOCATION_HISTORY_INTERVAL_MS = 20 * 60 * 1000L;
    private static final long FIX_TIMEOUT_MS = 25 * 1000L;
    // 위치 확보(최대 25초) + 전송 재시도까지 넉넉히 덮는 시간. 끝나면 즉시 풀어준다.
    private static final long TICK_WAKELOCK_MS = 90 * 1000L;
    // 연속 위치 업데이트가 이 시간 안에 이미 보냈다면, 알람 주기에서는 새 위치를 또 잡지 않는다.
    private static final long RECENT_SEND_SKIP_MS = 60 * 1000L;

    static volatile boolean isRunning = false;

    private HandlerThread workerThread;
    private Handler workerHandler;
    private FusedLocationProviderClient fused;
    private PowerManager.WakeLock tickWakeLock;
    private final AtomicBoolean tickInProgress = new AtomicBoolean(false);

    // 알람 주기와 별개로, 시스템이 움직임/주기에 맞춰 위치를 밀어주는 경로. 알람이 절전 모드
    // 때문에 늦어지더라도 이쪽이 먼저 깨워줄 수 있어 이중 안전장치가 된다.
    private final LocationCallback continuousCallback = new LocationCallback() {
        @Override
        public void onLocationResult(@NonNull LocationResult result) {
            Location loc = result.getLastLocation();
            if (loc == null || workerHandler == null) return;
            workerHandler.post(() -> {
                long sinceLastSend = System.currentTimeMillis() - ProfileStore.getLastSentAt(getApplicationContext());
                if (sinceLastSend < UPDATE_INTERVAL_MS - 30 * 1000L) return; // 주기보다 자주 보내지 않는다
                acquireTickWakeLock();
                try {
                    sendLocation(loc);
                } finally {
                    releaseTickWakeLock();
                }
            });
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        workerThread = new HandlerThread("LocationShareWorker");
        workerThread.start();
        workerHandler = new Handler(workerThread.getLooper());
        fused = LocationServices.getFusedLocationProviderClient(this);
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            tickWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "LocationShare:tick");
            tickWakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Context ctx = getApplicationContext();
        if (!ProfileStore.isSharingEnabled(ctx) || !ProfileStore.hasValidProfile(ctx)) {
            LocationWatchdog.cancel(ctx);
            stopSelfSafely();
            return START_NOT_STICKY;
        }
        if (!hasAnyLocationPermission()) {
            // 위치 권한이 아예 없으면(사용자가 설정에서 취소) startForeground(location) 자체가
            // SecurityException으로 죽는다. 알람은 유지해서 권한이 다시 생기면 자동 재개한다.
            LocationWatchdog.scheduleNext(ctx, UPDATE_INTERVAL_MS);
            stopSelfSafely();
            return START_NOT_STICKY;
        }
        // startForegroundService()로 불릴 때마다 5초 안에 startForeground()가 필요하므로 매번 호출한다.
        if (!enterForeground()) {
            LocationWatchdog.scheduleNext(ctx, UPDATE_INTERVAL_MS);
            stopSelfSafely();
            return START_NOT_STICKY;
        }
        if (!isRunning) {
            isRunning = true;
            startContinuousUpdates();
        }
        // 다음 주기를 먼저 예약한다 - 이번 주기가 어떻게 끝나든 사슬이 끊기지 않게.
        LocationWatchdog.scheduleNext(ctx, UPDATE_INTERVAL_MS);
        runTick();
        return START_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 최근 앱 목록에서 밀어서 지운 경우 일부 제조사는 서비스까지 같이 죽인다 - 곧바로 다시 깨운다.
        if (ProfileStore.isSharingEnabled(getApplicationContext())) {
            LocationWatchdog.scheduleNext(getApplicationContext(), 5 * 1000L);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        boolean wasRunning = isRunning;
        isRunning = false;
        try {
            if (fused != null) fused.removeLocationUpdates(continuousCallback);
        } catch (Exception ignored) {}
        if (workerHandler != null) workerHandler.removeCallbacksAndMessages(null);
        if (workerThread != null) workerThread.quitSafely();
        releaseTickWakeLock();
        // 공유가 여전히 켜져 있는데 시스템이 서비스를 죽인 경우를 대비해 알람은 남겨둔다
        // (꺼진 경우는 onStartCommand / NativeProfileBridge에서 이미 취소됨).
        if (wasRunning && ProfileStore.isSharingEnabled(getApplicationContext())) {
            LocationWatchdog.scheduleNext(getApplicationContext(), 30 * 1000L);
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopSelfSafely() {
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        } catch (Exception ignored) {}
        stopSelf();
    }

    private boolean hasAnyLocationPermission() {
        return ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean enterForeground() {
        try {
            createNotificationChannel();
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
            return true;
        } catch (Exception e) {
            // Android 12+의 ForegroundServiceStartNotAllowedException, 14+의 권한 SecurityException 등.
            return false;
        }
    }

    @SuppressLint("MissingPermission")
    private void startContinuousUpdates() {
        if (!hasAnyLocationPermission()) return;
        try {
            LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, UPDATE_INTERVAL_MS)
                    .setMinUpdateIntervalMillis(60 * 1000L)
                    .setMinUpdateDistanceMeters(0f) // 안 움직여도 주기마다 받는다
                    .setMaxUpdateDelayMillis(UPDATE_INTERVAL_MS) // 몰아서 늦게 주지 않도록
                    .build();
            fused.requestLocationUpdates(request, continuousCallback, workerThread.getLooper());
        } catch (Exception ignored) {}
    }

    // 알람이 깨울 때마다 한 번: WakeLock을 잡고, 새 위치를 받아(최대 25초) 보내고, 못 받으면
    // 마지막 위치로라도 보낸다. 동시에 두 번 돌지 않게 막는다.
    @SuppressLint("MissingPermission")
    private void runTick() {
        if (!tickInProgress.compareAndSet(false, true)) return;
        acquireTickWakeLock();
        workerHandler.post(() -> {
            Context ctx = getApplicationContext();
            long sinceLastSend = System.currentTimeMillis() - ProfileStore.getLastSentAt(ctx);
            if (sinceLastSend < RECENT_SEND_SKIP_MS) {
                finishTick();
                return;
            }
            final AtomicBoolean done = new AtomicBoolean(false);
            final CancellationTokenSource cts = new CancellationTokenSource();
            Runnable timeout = () -> {
                if (!done.compareAndSet(false, true)) return;
                cts.cancel();
                sendFallbackLocation();
                finishTick();
            };
            workerHandler.postDelayed(timeout, FIX_TIMEOUT_MS);
            try {
                int priority = hasFinePermission() ? Priority.PRIORITY_HIGH_ACCURACY : Priority.PRIORITY_BALANCED_POWER_ACCURACY;
                fused.getCurrentLocation(priority, cts.getToken())
                        .addOnCompleteListener(command -> workerHandler.post(command), task -> {
                            if (!done.compareAndSet(false, true)) return;
                            workerHandler.removeCallbacks(timeout);
                            Location loc = task.isSuccessful() ? task.getResult() : null;
                            if (loc != null) sendLocation(loc);
                            else sendFallbackLocation();
                            finishTick();
                        });
            } catch (Exception e) {
                workerHandler.removeCallbacks(timeout);
                if (done.compareAndSet(false, true)) {
                    sendFallbackLocation();
                    finishTick();
                }
            }
        });
    }

    private void finishTick() {
        tickInProgress.set(false);
        releaseTickWakeLock();
    }

    private boolean hasFinePermission() {
        return ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void acquireTickWakeLock() {
        try {
            if (tickWakeLock != null) tickWakeLock.acquire(TICK_WAKELOCK_MS);
        } catch (Exception ignored) {}
    }

    private void releaseTickWakeLock() {
        try {
            if (tickWakeLock != null && tickWakeLock.isHeld()) tickWakeLock.release();
        } catch (Exception ignored) {}
    }

    // 새 위치를 못 받았을 때: 시스템의 마지막 위치 -> 이 앱이 마지막으로 보낸 위치 순으로 쓴다.
    // 좌표는 조금 오래됐을 수 있지만, 친구 화면에서 "신호 없음(회색)"으로 떨어지지 않게 하는 게 목적.
    @SuppressLint("MissingPermission")
    private void sendFallbackLocation() {
        Location last = null;
        try {
            if (hasAnyLocationPermission()) {
                last = com.google.android.gms.tasks.Tasks.await(fused.getLastLocation(), 5, java.util.concurrent.TimeUnit.SECONDS);
            }
        } catch (Exception ignored) {}
        if (last != null) {
            sendLocation(last);
            return;
        }
        Context ctx = getApplicationContext();
        if (ProfileStore.hasLastLocation(ctx)) {
            upload(ProfileStore.getLastLat(ctx), ProfileStore.getLastLng(ctx), ProfileStore.getLastAccuracy(ctx));
        }
    }

    private void sendLocation(Location location) {
        Context ctx = getApplicationContext();
        ProfileStore.setLastLocation(ctx, location.getLatitude(), location.getLongitude(), location.getAccuracy());
        upload(location.getLatitude(), location.getLongitude(), location.getAccuracy());
    }

    private void upload(double lat, double lng, float accuracy) {
        Context ctx = getApplicationContext();
        String memberId = ProfileStore.getMemberId(ctx);
        String groupCode = ProfileStore.getGroupCode(ctx);
        String databaseURL = ProfileStore.getDatabaseURL(ctx);
        String name = ProfileStore.getName(ctx);
        if (memberId == null || groupCode == null || databaseURL == null) return;

        String base = databaseURL + "/groups/" + encode(groupCode) + "/members/" + encode(memberId);
        boolean ok = false;
        try {
            JSONObject body = new JSONObject();
            body.put("name", name);
            body.put("lat", lat);
            body.put("lng", lng);
            body.put("accuracy", accuracy);
            body.put("updatedAt", serverTimestamp());
            // PATCH: 친구의 위치 요청 표시(locationRequestedAt)나 history 등 다른 필드는 지우지 않는다.
            ok = requestWithRetry(base + ".json?x-http-method-override=PATCH", "PATCH", body.toString());
        } catch (Exception ignored) {}
        if (ok) ProfileStore.setLastSentAt(ctx, System.currentTimeMillis());

        long now = System.currentTimeMillis();
        if (ok && now - ProfileStore.getLastHistoryWriteAt(ctx) >= LOCATION_HISTORY_INTERVAL_MS) {
            try {
                JSONObject h = new JSONObject();
                h.put("lat", lat);
                h.put("lng", lng);
                h.put("accuracy", accuracy);
                h.put("ts", serverTimestamp());
                if (requestWithRetry(base + "/history.json", "POST", h.toString())) {
                    ProfileStore.setLastHistoryWriteAt(ctx, now);
                }
            } catch (Exception ignored) {}
        }
    }

    private static JSONObject serverTimestamp() throws Exception {
        JSONObject ts = new JSONObject();
        ts.put(".sv", "timestamp");
        return ts;
    }

    // 잠깐 네트워크가 끊긴(엘리베이터, 지하, 기지국 전환 등) 경우를 위해 몇 번 다시 시도한다.
    private static boolean requestWithRetry(String url, String method, String body) {
        long[] backoff = {0L, 3000L, 8000L, 15000L};
        for (long wait : backoff) {
            if (wait > 0) {
                try { Thread.sleep(wait); } catch (InterruptedException e) { return false; }
            }
            try {
                int status = httpRequest(url, method, body);
                if (status >= 200 && status < 300) return true;
                if (status >= 400 && status < 500) return false; // 규칙/주소 문제는 재시도해도 소용없다
            } catch (Exception ignored) {}
        }
        return false;
    }

    private static String encode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private static int httpRequest(String urlStr, String method, String body) throws Exception {
        // HttpURLConnection은 PATCH를 지원하지 않으므로 Firebase REST의 x-http-method-override를 쓴다.
        String realMethod = "PATCH".equals(method) ? "POST" : method;
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        try {
            conn.setRequestMethod(realMethod);
            if ("PATCH".equals(method)) conn.setRequestProperty("X-HTTP-Method-Override", "PATCH");
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
            // IMPORTANCE_LOW: 소리/진동 없이 표시만. MIN은 일부 기기에서 포그라운드 서비스를 덜
            // 중요하게 취급해 정리 대상이 되기 쉬워서 쓰지 않는다.
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "위치 공유", NotificationManager.IMPORTANCE_LOW);
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
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setPriority(NotificationCompat.PRIORITY_LOW);
        if (contentIntent != null) builder.setContentIntent(contentIntent);
        return builder.build();
    }
}
