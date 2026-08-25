package com.green3077.photoorganizer

import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.green3077.photoorganizer.data.PhotoDeleter
import com.green3077.photoorganizer.data.StreakTracker
import com.green3077.photoorganizer.databinding.ActivityPhotoViewerBinding
import com.green3077.photoorganizer.model.Photo
import com.green3077.photoorganizer.ui.PhotoPagerAdapter
import com.green3077.photoorganizer.ui.PhotoViewerHolder

class PhotoViewerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPhotoViewerBinding
    private var photos: List<Photo> = PhotoViewerHolder.photos

    private val deleteLauncher =
        registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            if (result.resultCode == RESULT_OK) onDeleteConfirmed()
        }
    private val deleter by lazy { PhotoDeleter(this, deleteLauncher) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPhotoViewerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (photos.isEmpty()) {
            finish()
            return
        }

        binding.pager.adapter = PhotoPagerAdapter(photos)
        binding.pager.setCurrentItem(intent.getIntExtra(EXTRA_INDEX, 0), false)

        setSupportActionBar(binding.toolbar)
        binding.toolbar.setNavigationOnClickListener { finish() }
        binding.toolbar.setOnMenuItemClickListener { item ->
            if (item.itemId == R.id.action_delete) {
                photos.getOrNull(binding.pager.currentItem)?.let { deleter.requestDelete(listOf(it.uri)) }
                true
            } else false
        }
    }

    private fun onDeleteConfirmed() {
        StreakTracker.recordOrganizedToday(this)
        val current = binding.pager.currentItem
        photos = photos.filterIndexed { index, _ -> index != current }
        if (photos.isEmpty()) {
            finish()
            return
        }
        binding.pager.adapter = PhotoPagerAdapter(photos)
        binding.pager.setCurrentItem(current.coerceAtMost(photos.size - 1), false)
    }

    companion object {
        const val EXTRA_INDEX = "extra_index"
    }
}
