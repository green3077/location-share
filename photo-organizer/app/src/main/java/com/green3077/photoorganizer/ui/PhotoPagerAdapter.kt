package com.green3077.photoorganizer.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.green3077.photoorganizer.databinding.ItemPhotoPageBinding
import com.green3077.photoorganizer.model.Photo

class PhotoPagerAdapter(private val photos: List<Photo>) :
    RecyclerView.Adapter<PhotoPagerAdapter.ViewHolder>() {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemPhotoPageBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.binding.image.load(photos[position].uri)
    }

    override fun getItemCount() = photos.size

    class ViewHolder(val binding: ItemPhotoPageBinding) : RecyclerView.ViewHolder(binding.root)
}
