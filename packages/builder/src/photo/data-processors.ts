import path from 'node:path'

import type { PhotoManifestItem, PickedExif, ThumbnailVariantFile, ToneAnalysis } from '@afilmory/typing'
import { decompressUint8Array } from '@afilmory/utils'
import type sharp from 'sharp'

import { HEIC_FORMATS } from '../constants/index.js'
import { extractExifData } from '../image/exif.js'
import { calculateHistogramAndAnalyzeTone } from '../image/histogram.js'
import { generateThumbnailAndBlurhash, readCachedThumbnailFiles } from '../image/thumbnail.js'
import { contentHashOf } from '../utils/content-hash.js'
import { getGlobalLoggers } from './logger-adapter.js'
import type { PhotoProcessorOptions } from './processor.js'

export interface ThumbnailResult {
  thumbnailUrl: string
  thumbnailFileName: string
  thumbnailBuffer: Buffer
  thumbHash: Uint8Array | null
  thumbnailVariants: ThumbnailVariantFile[]
}

/**
 * 处理缩略图和 blurhash
 * 优先复用现有数据，如果不存在或需要强制更新则重新生成
 */
export async function processThumbnailAndBlurhash(
  imageBuffer: Buffer,
  photoId: string,
  existingItem: PhotoManifestItem | undefined,
  options: PhotoProcessorOptions,
): Promise<ThumbnailResult> {
  const loggers = getGlobalLoggers()

  // 检查是否可以复用现有数据。文件按内容寻址：先确认内容没变，再按索引把文件读回来
  if (!options.isForceMode && !options.isForceThumbnails && existingItem?.thumbHash) {
    const cached = await readCachedThumbnailFiles(photoId, contentHashOf(imageBuffer))
    if (cached) {
      loggers.blurhash.info(`复用现有 blurhash: ${photoId}`)
      loggers.thumbnail.info(`复用现有缩略图：${photoId}`)

      return {
        thumbnailUrl: `/thumbnails/${cached.thumbnailFileName}`,
        thumbnailFileName: cached.thumbnailFileName,
        thumbnailBuffer: cached.thumbnailBuffer,
        thumbHash: decompressUint8Array(existingItem.thumbHash),
        // 候选图 URL 由存储插件在 afterPhotoProcess 阶段按需回填
        thumbnailVariants: cached.variants,
      }
    }

    loggers.thumbnail.info(`缩略图缓存不匹配（内容已变或文件缺失），重新生成：${photoId}`)
  }

  // 生成新的缩略图和 blurhash
  const result = await generateThumbnailAndBlurhash(
    imageBuffer,
    photoId,
    options.isForceMode || options.isForceThumbnails,
  )

  return {
    thumbnailUrl: result.thumbnailUrl!,
    thumbnailFileName: result.thumbnailFileName!,
    thumbnailBuffer: result.thumbnailBuffer!,
    thumbHash: result.thumbHash!,
    thumbnailVariants: result.thumbnailVariants ?? [],
  }
}

/**
 * 处理 EXIF 数据
 * 优先复用现有数据，如果不存在或需要强制更新则重新提取
 */
export async function processExifData(
  imageBuffer: Buffer,
  rawImageBuffer: Buffer | undefined,
  photoKey: string,
  existingItem: PhotoManifestItem | undefined,
  options: PhotoProcessorOptions,
): Promise<PickedExif | null> {
  const loggers = getGlobalLoggers()

  // 检查是否可以复用现有数据
  if (!options.isForceMode && !options.isForceManifest && existingItem?.exif) {
    const photoId = path.basename(photoKey, path.extname(photoKey))
    loggers.exif.info(`复用现有 EXIF 数据：${photoId}`)
    return existingItem.exif
  }

  // 提取新的 EXIF 数据
  const ext = path.extname(photoKey).toLowerCase()
  const originalBuffer = HEIC_FORMATS.has(ext) ? rawImageBuffer : undefined

  return await extractExifData(imageBuffer, originalBuffer)
}

/**
 * 处理影调分析
 * 优先复用现有数据，如果不存在或需要强制更新则重新计算
 */
export async function processToneAnalysis(
  sharpInstance: sharp.Sharp,
  photoKey: string,
  existingItem: PhotoManifestItem | undefined,
  options: PhotoProcessorOptions,
): Promise<ToneAnalysis | null> {
  const loggers = getGlobalLoggers()

  // 检查是否可以复用现有数据
  if (!options.isForceMode && !options.isForceManifest && existingItem?.toneAnalysis) {
    const photoId = path.basename(photoKey, path.extname(photoKey))
    loggers.tone.info(`复用现有影调分析：${photoId}`)
    return existingItem.toneAnalysis
  }

  // 计算新的影调分析
  return await calculateHistogramAndAnalyzeTone(sharpInstance)
}
