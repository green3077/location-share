package com.green3077.photoorganizer.ui

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.green3077.photoorganizer.databinding.ItemMemoryGroupBinding
import com.green3077.photoorganizer.model.MemoryGroup
import com.green3077.photoorganizer.util.DateFormat

class MemoryGroupAdapter(
    private val onClick: (MemoryGroup) -> Unit
) : RecyclerView.Adapter<MemoryGroupAdapter.ViewHolder>() {

    private val items = mutableListOf<MemoryGroup>()

    fun submit(groups: List<MemoryGroup>) {
        items.clear()
        items.addAll(groups)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemMemoryGroupBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) = holder.bind(items[position])

    override fun getItemCount() = items.size

    inner class ViewHolder(private val binding: ItemMemoryGroupBinding) :
        RecyclerView.ViewHolder(binding.root) {
        fun bind(group: MemoryGroup) {
            binding.image.load(group.coverPhoto.uri) { crossfade(true) }
            binding.textDate.text = DateFormat.monthDayLabel(group.monthDay)
            binding.textSummary.text = "${group.yearCount}개 연도 · 총 ${group.photoCount}장"
            binding.root.setOnClickListener { onClick(group) }
        }
    }
}
