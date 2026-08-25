package com.green3077.photoorganizer.data

import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest

class PhotoDeleter(
    private val context: Context,
    private val launcher: ActivityResultLauncher<IntentSenderRequest>
) {
    fun requestDelete(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val pendingIntent = MediaStore.createDeleteRequest(context.contentResolver, uris)
        launcher.launch(IntentSenderRequest.Builder(pendingIntent.intentSender).build())
    }
}
