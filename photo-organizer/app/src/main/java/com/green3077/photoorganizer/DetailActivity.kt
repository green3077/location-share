package com.green3077.photoorganizer

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import com.green3077.photoorganizer.data.PhotoDeleter
import com.green3077.photoorganizer.data.PhotoRepository
import com.green3077.photoorganizer.data.StreakTracker
import com.green3077.photoorganizer.databinding.ActivityDetailBinding
import com.green3077.photoorganizer.model.Photo
import com.green3077.photoorganizer.ui.DetailListAdapter
import com.green3077.photoorganizer.ui.PhotoViewerHolder
import com.green3077.photoorganizer.util.DateFormat
import kotlinx.coroutines.launch
import java.time.MonthDay

class DetailActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDetailBinding
    private lateinit var adapter: DetailListAdapter
    private lateinit var monthDay: MonthDay
    private val repository by lazy { PhotoRepository(this) }
    private var photosByYear: Map<Int, List<Photo>> = emptyMap()
    private val selectedIds = mutableSetOf<Long>()

    private val deleteLauncher =
        registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            if (result.resultCode == RESULT_OK) {
                StreakTracker.recordOrganizedToday(this)
                selectedIds.clear()
                loadPhotos()
            }
        }
    private val deleter by lazy { PhotoDeleter(this, deleteLauncher) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val month = intent.getIntExtra(EXTRA_MONTH, -1)
        val day = intent.getIntExtra(EXTRA_DAY, -1)
        if (month == -1 || day == -1) {
            finish()
            return
        }
        monthDay = MonthDay.of(month, day)

        binding = ActivityDetailBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        binding.toolbar.title = DateFormat.monthDayLabel(monthDay)
        binding.toolbar.setNavigationOnClickListener { finish() }
        binding.toolbar.setOnMenuItemClickListener { item ->
            if (item.itemId == R.id.action_delete) {
                confirmDelete()
                true
            } else false
        }

        adapter = DetailListAdapter(
            isSelected = { selectedIds.contains(it) },
            onPhotoClick = ::onPhotoClick,
            onPhotoLongClick = ::toggleSelection
        )

        val spanCount = 3
        val layoutManager = GridLayoutManager(this, spanCount)
        layoutManager.spanSizeLookup = object : GridLayoutManager.SpanSizeLookup() {
            override fun getSpanSize(position: Int): Int =
                if (adapter.isHeaderAt(position)) spanCount else 1
        }
        binding.recyclerPhotos.layoutManager = layoutManager
        binding.recyclerPhotos.adapter = adapter
    }

    override fun onResume() {
        super.onResume()
        loadPhotos()
    }

    private fun loadPhotos() {
        lifecycleScope.launch {
            val allPhotos = repository.loadAllPhotos()
            photosByYear = repository.photosForMonthDay(allPhotos, monthDay)
            selectedIds.retainAll(photosByYear.values.flatten().map { it.id }.toSet())
            adapter.submit(photosByYear)
            binding.emptyState.visibility = if (photosByYear.isEmpty()) View.VISIBLE else View.GONE
            binding.recyclerPhotos.visibility = if (photosByYear.isEmpty()) View.GONE else View.VISIBLE
            updateSelectionUi()
        }
    }

    private fun onPhotoClick(photo: Photo) {
        if (selectedIds.isNotEmpty()) {
            toggleSelection(photo)
            return
        }
        val yearPhotos = photosByYear[photo.dateTaken.year].orEmpty()
        PhotoViewerHolder.photos = yearPhotos
        val index = yearPhotos.indexOfFirst { it.id == photo.id }.coerceAtLeast(0)
        startActivity(
            Intent(this, PhotoViewerActivity::class.java).apply {
                putExtra(PhotoViewerActivity.EXTRA_INDEX, index)
            }
        )
    }

    private fun toggleSelection(photo: Photo) {
        if (!selectedIds.remove(photo.id)) selectedIds.add(photo.id)
        adapter.notifyDataSetChanged()
        updateSelectionUi()
    }

    private fun updateSelectionUi() {
        binding.toolbar.menu.findItem(R.id.action_delete)?.isVisible = selectedIds.isNotEmpty()
        binding.toolbar.title = if (selectedIds.isNotEmpty()) {
            getString(R.string.selected_count, selectedIds.size)
        } else {
            DateFormat.monthDayLabel(monthDay)
        }
    }

    private fun confirmDelete() {
        val urisToDelete = photosByYear.values.flatten()
            .filter { selectedIds.contains(it.id) }
            .map { it.uri }
        deleter.requestDelete(urisToDelete)
    }

    companion object {
        const val EXTRA_MONTH = "extra_month"
        const val EXTRA_DAY = "extra_day"
    }
}
