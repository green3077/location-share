package com.green3077.photoorganizer

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.datepicker.MaterialDatePicker
import com.green3077.photoorganizer.data.PhotoRepository
import com.green3077.photoorganizer.data.StreakTracker
import com.green3077.photoorganizer.databinding.ActivityMainBinding
import com.green3077.photoorganizer.model.Photo
import com.green3077.photoorganizer.notification.WorkScheduler
import com.green3077.photoorganizer.ui.MemoryGroupAdapter
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.MonthDay
import java.time.ZoneOffset

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var groupAdapter: MemoryGroupAdapter
    private val repository by lazy { PhotoRepository(this) }
    private var allPhotos: List<Photo> = emptyList()

    private val requestPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) onMediaPermissionGranted() else showPermissionGate()
        }

    private val requestNotificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)

        groupAdapter = MemoryGroupAdapter { group -> openDetail(group.monthDay) }
        binding.recyclerGroups.layoutManager = LinearLayoutManager(this)
        binding.recyclerGroups.adapter = groupAdapter

        binding.toolbar.setOnMenuItemClickListener { item ->
            if (item.itemId == R.id.action_pick_date) {
                showDatePicker()
                true
            } else false
        }

        binding.btnGrantPermission.setOnClickListener { requestPermissionLauncher.launch(requiredPermission()) }
        binding.swipeRefresh.setOnRefreshListener { loadPhotos() }
    }

    override fun onStart() {
        super.onStart()
        if (hasPermission()) onMediaPermissionGranted() else showPermissionGate()
    }

    private fun requiredPermission(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.READ_MEDIA_IMAGES
        else Manifest.permission.READ_EXTERNAL_STORAGE

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, requiredPermission()) == PackageManager.PERMISSION_GRANTED

    private fun onMediaPermissionGranted() {
        loadPhotos()
        WorkScheduler.scheduleDaily(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun loadPhotos() {
        showLoading()
        lifecycleScope.launch {
            allPhotos = repository.loadAllPhotos()
            val groups = repository.buildRecurringMemoryGroups(allPhotos, MonthDay.now())
            groupAdapter.submit(groups)
            binding.swipeRefresh.isRefreshing = false
            showContent(groups.isNotEmpty())
            val streak = StreakTracker.currentStreak(this@MainActivity)
            binding.toolbar.subtitle = if (streak >= 1) getString(R.string.streak_banner, streak) else null
        }
    }

    private fun showLoading() {
        binding.progress.visibility = View.VISIBLE
        binding.permissionGate.visibility = View.GONE
        binding.emptyState.visibility = View.GONE
        binding.recyclerGroups.visibility = View.GONE
    }

    private fun showContent(hasGroups: Boolean) {
        binding.progress.visibility = View.GONE
        binding.permissionGate.visibility = View.GONE
        binding.recyclerGroups.visibility = if (hasGroups) View.VISIBLE else View.GONE
        binding.emptyState.visibility = if (hasGroups) View.GONE else View.VISIBLE
    }

    private fun showPermissionGate() {
        binding.progress.visibility = View.GONE
        binding.emptyState.visibility = View.GONE
        binding.recyclerGroups.visibility = View.GONE
        binding.permissionGate.visibility = View.VISIBLE
        binding.swipeRefresh.isRefreshing = false
    }

    private fun showDatePicker() {
        val picker = MaterialDatePicker.Builder.datePicker()
            .setTitleText(getString(R.string.pick_date))
            .build()
        picker.addOnPositiveButtonClickListener { selection ->
            val date = Instant.ofEpochMilli(selection).atZone(ZoneOffset.UTC).toLocalDate()
            openDetail(MonthDay.from(date))
        }
        picker.show(supportFragmentManager, "date_picker")
    }

    private fun openDetail(monthDay: MonthDay) {
        startActivity(
            Intent(this, DetailActivity::class.java).apply {
                putExtra(DetailActivity.EXTRA_MONTH, monthDay.monthValue)
                putExtra(DetailActivity.EXTRA_DAY, monthDay.dayOfMonth)
            }
        )
    }
}
