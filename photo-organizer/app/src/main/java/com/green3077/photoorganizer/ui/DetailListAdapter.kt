package com.green3077.photoorganizer.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.green3077.photoorganizer.databinding.ItemPhotoBinding
import com.green3077.photoorganizer.databinding.ItemYearHeaderBinding
import com.green3077.photoorganizer.model.Photo
import com.green3077.photoorganizer.util.DateFormat
import java.time.LocalDate

sealed class DetailRow {
    data class YearHeader(val year: Int, val count: Int) : DetailRow()
    data class PhotoRow(val photo: Photo) : DetailRow()
}

class DetailListAdapter(
    private val isSelected: (Long) -> Boolean,
    private val onPhotoClick: (Photo) -> Unit,
    private val onPhotoLongClick: (Photo) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private val items = mutableListOf<DetailRow>()

    fun submit(photosByYear: Map<Int, List<Photo>>) {
        items.clear()
        for ((year, photos) in photosByYear) {
            items.add(DetailRow.YearHeader(year, photos.size))
            photos.forEach { items.add(DetailRow.PhotoRow(it)) }
        }
        notifyDataSetChanged()
    }

    fun isHeaderAt(position: Int): Boolean = items[position] is DetailRow.YearHeader

    override fun getItemViewType(position: Int) = when (items[position]) {
        is DetailRow.YearHeader -> TYPE_HEADER
        is DetailRow.PhotoRow -> TYPE_PHOTO
    }

    override fun getItemCount() = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == TYPE_HEADER) {
            HeaderViewHolder(ItemYearHeaderBinding.inflate(inflater, parent, false))
        } else {
            PhotoViewHolder(ItemPhotoBinding.inflate(inflater, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val row = items[position]) {
            is DetailRow.YearHeader -> (holder as HeaderViewHolder).bind(row)
            is DetailRow.PhotoRow -> (holder as PhotoViewHolder).bind(row.photo)
        }
    }

    inner class HeaderViewHolder(private val binding: ItemYearHeaderBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(header: DetailRow.YearHeader) {
            binding.textYear.text = DateFormat.yearLabel(header.year, LocalDate.now())
            binding.textCount.text = "${header.count}장"
        }
    }

    inner class PhotoViewHolder(private val binding: ItemPhotoBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(photo: Photo) {
            binding.image.load(photo.uri) { crossfade(true) }
            binding.checkOverlay.visibility = if (isSelected(photo.id)) View.VISIBLE else View.GONE
            binding.root.setOnClickListener { onPhotoClick(photo) }
            binding.root.setOnLongClickListener {
                onPhotoLongClick(photo)
                true
            }
        }
    }

    companion object {
        private const val TYPE_HEADER = 0
        private const val TYPE_PHOTO = 1
    }
}
