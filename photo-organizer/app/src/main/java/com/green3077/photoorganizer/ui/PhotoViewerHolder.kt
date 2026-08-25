package com.green3077.photoorganizer.ui

import com.green3077.photoorganizer.model.Photo

/**
 * ViewerActivity에 넘길 사진 목록을 담아두는 임시 보관소.
 * Intent extra로 넘기기엔 목록이 커질 수 있어(TransactionTooLargeException 방지) 메모리로 전달한다.
 */
object PhotoViewerHolder {
    var photos: List<Photo> = emptyList()
}
