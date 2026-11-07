import type { Buffer } from 'node:buffer'

import type { ThumbnailFormat } from '@afilmory/typing'

export const THUMBNAIL_PLUGIN_DATA_KEY = 'afilmory:thumbnail-storage:data'

/**
 * Unique symbol identifier for the thumbnail storage plugin.
 * Used for reliable plugin detection without fragile string matching.
 */
export const THUMBNAIL_PLUGIN_SYMBOL = Symbol.for('afilmory:thumbnail-storage')

/** 待上传的缩略图候选（WebP/AVIF） */
export interface ThumbnailVariantUpload {
  fileName: string
  width: number
  format: ThumbnailFormat
  contentType: string
  buffer: Buffer | null
  localUrl: string | null
}

export interface ThumbnailPluginData {
  photoId: string
  /** 默认 JPEG 缩略图文件名（带内容指纹） */
  fileName: string
  buffer: Buffer | null
  localUrl: string | null
  /** 响应式候选图 */
  variants: ThumbnailVariantUpload[]
}
export const DEFAULT_DIRECTORY = '.afilmory/thumbnails'
export const DEFAULT_CONTENT_TYPE = 'image/jpeg'

/**
 * 长期缓存策略。
 * 缩略图与 OG 图的文件名都带内容指纹（内容寻址），内容变了 URL 必变，
 * 所以这里才敢上 immutable —— 前提由 `contentHashOf` 保证，别把这条挪给无指纹的资源。
 */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** 按文件扩展名推断 Content-Type，用于给对象补齐正确的元数据 */
export function contentTypeFromFileName(fileName: string): string {
  const lowered = fileName.toLowerCase()
  if (lowered.endsWith('.avif')) return 'image/avif'
  if (lowered.endsWith('.webp')) return 'image/webp'
  if (lowered.endsWith('.png')) return 'image/png'
  if (lowered.endsWith('.jpg') || lowered.endsWith('.jpeg')) return 'image/jpeg'
  return DEFAULT_CONTENT_TYPE
}
