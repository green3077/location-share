package com.green3077.locationshare;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * localStorage(웹뷰)의 profile을 그대로 미러링하는 저장소. 재부팅 직후 BootReceiver나
 * 프로세스가 죽은 뒤 LocationWatchdog이 재시작할 때는 JS/localStorage에 접근할 수 없으므로
 * 이 SharedPreferences가 유일한 통로다 - app.js의 syncNativeProfile()과 항상 같이 맞출 것.
 */
final class ProfileStore {
    private static final String PREFS_NAME = "ls_native_profile";
    private static final String KEY_SHARING_ENABLED = "sharingEnabled";
    private static final String KEY_MEMBER_ID = "memberId";
    private static final String KEY_NAME = "name";
    private static final String KEY_GROUP_CODE = "groupCode";
    private static final String KEY_DATABASE_URL = "databaseURL";
    private static final String KEY_LAST_HISTORY_WRITE = "lastHistoryWriteAt";

    private ProfileStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    static void save(Context context, boolean sharingEnabled, String memberId, String name, String groupCode, String databaseURL) {
        prefs(context).edit()
                .putBoolean(KEY_SHARING_ENABLED, sharingEnabled)
                .putString(KEY_MEMBER_ID, memberId)
                .putString(KEY_NAME, name)
                .putString(KEY_GROUP_CODE, groupCode)
                .putString(KEY_DATABASE_URL, databaseURL)
                .apply();
    }

    static boolean isSharingEnabled(Context context) {
        return prefs(context).getBoolean(KEY_SHARING_ENABLED, false);
    }

    static String getMemberId(Context context) {
        return prefs(context).getString(KEY_MEMBER_ID, null);
    }

    static String getName(Context context) {
        return prefs(context).getString(KEY_NAME, null);
    }

    static String getGroupCode(Context context) {
        return prefs(context).getString(KEY_GROUP_CODE, null);
    }

    static String getDatabaseURL(Context context) {
        return prefs(context).getString(KEY_DATABASE_URL, null);
    }

    static boolean hasValidProfile(Context context) {
        return getMemberId(context) != null && getGroupCode(context) != null && getDatabaseURL(context) != null;
    }

    static long getLastHistoryWriteAt(Context context) {
        return prefs(context).getLong(KEY_LAST_HISTORY_WRITE, 0L);
    }

    static void setLastHistoryWriteAt(Context context, long ts) {
        prefs(context).edit().putLong(KEY_LAST_HISTORY_WRITE, ts).apply();
    }
}
