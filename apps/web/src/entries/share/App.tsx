import type { PhotoManifestItem } from '@afilmory/builder'
import { useEffect, useState } from 'react'

import { MasonryGallery } from './components/MasonryGallery'
import { PhotoItem } from './components/PhotoItem'

declare global {
  interface Window {
    __SHARE_DATA__?: PhotoManifestItem | PhotoManifestItem[]
  }
}

export function App() {
  const [photos, setPhotos] = useState<PhotoManifestItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      const shareData = window.__SHARE_DATA__
      if (!shareData) {
        setLoading(false)
        return
      }

      // Handle both single photo and array of photos
      const loadedPhotos = Array.isArray(shareData) ? shareData : [shareData]
      setPhotos(loadedPhotos)
    } catch (error) {
      console.error('Error loading photos:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-[#0a0a0a] text-white">Loading...</div>
  }

  if (photos.length === 0) {
    return <div className="flex h-screen items-center justify-center bg-[#0a0a0a] text-white">No photos found</div>
  }

  if (photos.length === 1) {
    return <PhotoItem photo={photos[0]} className="absolute inset-0 size-full pt-0!" sizes="100vw" />
  }

  return (
    <div className="h-screen bg-[#0a0a0a] text-white">
      <MasonryGallery photos={photos} />
    </div>
  )
}
