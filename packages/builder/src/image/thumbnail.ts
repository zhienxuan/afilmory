import fs from 'node:fs/promises'
import path from 'node:path'

import { workdir } from '@afilmory/builder/path.js'
import type { ThumbnailFormat, ThumbnailResult, ThumbnailVariantFile } from '@afilmory/typing'
import sharp from 'sharp'

import { getGlobalLoggers } from '../photo/logger-adapter.js'
import { generateBlurhash } from './blurhash.js'

// 常量定义
const THUMBNAIL_DIR = path.join(workdir, 'public/thumbnails')
const THUMBNAIL_QUALITY = 82
/** 默认（JPEG 兜底）缩略图宽度 */
const THUMBNAIL_WIDTH = 800
/** 响应式候选宽度档位，实际输出会按原图尺寸裁剪，不会放大 */
const VARIANT_WIDTHS = [400, 800, 1600] as const

const VARIANT_FORMATS: Array<{ format: ThumbnailFormat; extension: string; contentType: string }> = [
  { format: 'avif', extension: 'avif', contentType: 'image/avif' },
  { format: 'webp', extension: 'webp', contentType: 'image/webp' },
]

const FALLBACK_EXTENSION = 'jpg'
const FALLBACK_CONTENT_TYPE = 'image/jpeg'

/** 缩略图缓存索引，与图片文件同目录，用于复用与内容寻址 */
interface ThumbnailIndex {
  variants: Array<{
    fileName: string
    width: number
    format: ThumbnailFormat
    contentType: string
  }>
}

function getFallbackPaths(photoId: string) {
  const filename = `${photoId}.${FALLBACK_EXTENSION}`
  return {
    thumbnailPath: path.join(THUMBNAIL_DIR, filename),
    thumbnailUrl: `/thumbnails/${filename}`,
  }
}

function getIndexPath(photoId: string) {
  return path.join(THUMBNAIL_DIR, `${photoId}.thumbs.json`)
}

function getVariantFileName(photoId: string, width: number, extension: string) {
  return `${photoId}-${width}w.${extension}`
}

// 创建失败结果
function createFailureResult(): ThumbnailResult {
  return {
    thumbnailUrl: null,
    thumbnailBuffer: null,
    thumbHash: null,
    thumbnailVariants: [],
  }
}

// 创建成功结果
function createSuccessResult(
  thumbnailUrl: string,
  thumbnailBuffer: Buffer,
  thumbHash: Uint8Array | null,
  thumbnailVariants: ThumbnailVariantFile[],
): ThumbnailResult {
  return {
    thumbnailUrl,
    thumbnailBuffer,
    thumbHash,
    thumbnailVariants,
  }
}

// 确保缩略图目录存在
async function ensureThumbnailDir(): Promise<void> {
  await fs.mkdir(THUMBNAIL_DIR, { recursive: true })
}

async function readThumbnailIndex(photoId: string): Promise<ThumbnailIndex | null> {
  try {
    const raw = await fs.readFile(getIndexPath(photoId), 'utf-8')
    const parsed = JSON.parse(raw) as ThumbnailIndex
    if (!Array.isArray(parsed?.variants) || parsed.variants.length === 0) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function writeThumbnailIndex(photoId: string, variants: ThumbnailVariantFile[]): Promise<void> {
  const index: ThumbnailIndex = {
    variants: variants.map((variant) => ({
      fileName: variant.fileName,
      width: variant.width,
      format: variant.format,
      contentType: variant.contentType,
    })),
  }
  await fs.writeFile(getIndexPath(photoId), JSON.stringify(index, null, 2))
}

/**
 * 缩略图缓存是否完整。
 * 只有「JPEG 兜底 + 响应式候选索引」都在，才算命中缓存；
 * 旧版本只产出 JPEG，会让这里判为不完整并自动补生成候选图。
 */
export async function thumbnailExists(photoId: string): Promise<boolean> {
  try {
    const { thumbnailPath } = getFallbackPaths(photoId)
    await fs.access(thumbnailPath)
  } catch {
    return false
  }

  const index = await readThumbnailIndex(photoId)
  if (!index) {
    return false
  }

  try {
    await Promise.all(index.variants.map((variant) => fs.access(path.join(THUMBNAIL_DIR, variant.fileName))))
    return true
  } catch {
    return false
  }
}

async function buildVariantBuffers(
  sharpInstance: sharp.Sharp,
  sourceWidth: number,
  photoId: string,
): Promise<{ variants: ThumbnailVariantFile[] }> {
  const variants: ThumbnailVariantFile[] = []

  for (const width of VARIANT_WIDTHS) {
    // 不放大：原图比目标档位还小时，跳过该档位
    if (sourceWidth < width) {
      continue
    }

    for (const { format, extension, contentType } of VARIANT_FORMATS) {
      const piped = sharpInstance.clone().resize(width, null, { withoutEnlargement: true })
      const buffer = await (
        format === 'avif'
          ? piped.avif({ quality: THUMBNAIL_QUALITY, effort: 4 })
          : piped.webp({ quality: THUMBNAIL_QUALITY, effort: 4 })
      ).toBuffer()

      const fileName = getVariantFileName(photoId, width, extension)
      variants.push({
        fileName,
        width,
        format,
        contentType,
        buffer,
        localUrl: `/thumbnails/${fileName}`,
      })
    }
  }

  return { variants }
}

// 读取现有缩略图并生成 blurhash
async function processExistingThumbnail(photoId: string): Promise<ThumbnailResult | null> {
  const { thumbnailPath, thumbnailUrl } = getFallbackPaths(photoId)

  const thumbnailLog = getGlobalLoggers().thumbnail
  thumbnailLog.info(`复用现有缩略图：${photoId}`)

  try {
    const index = await readThumbnailIndex(photoId)
    if (!index) {
      return null
    }

    const existingBuffer = await fs.readFile(thumbnailPath)
    const thumbHash = await generateBlurhash(existingBuffer)

    const variants: ThumbnailVariantFile[] = []
    for (const variant of index.variants) {
      variants.push({
        ...variant,
        buffer: await fs.readFile(path.join(THUMBNAIL_DIR, variant.fileName)),
        localUrl: `/thumbnails/${variant.fileName}`,
      })
    }

    return createSuccessResult(thumbnailUrl, existingBuffer, thumbHash, variants)
  } catch (error) {
    thumbnailLog?.warn(`读取现有缩略图失败，重新生成：${photoId}`, error)
    return null
  }
}

// 生成新的缩略图
async function generateNewThumbnail(imageBuffer: Buffer, photoId: string): Promise<ThumbnailResult> {
  const { thumbnailPath, thumbnailUrl } = getFallbackPaths(photoId)

  const log = getGlobalLoggers().thumbnail
  log.info(`生成缩略图：${photoId}`)
  const startTime = Date.now()

  try {
    // 创建 Sharp 实例，复用于缩略图和 blurhash 生成
    const sharpInstance = sharp(imageBuffer).rotate() // 自动根据 EXIF 旋转
    const metadata = await sharpInstance.metadata()
    const sourceWidth = Math.min(metadata.width ?? THUMBNAIL_WIDTH, rotateWidth(metadata))

    // 生成默认 JPEG 兜底图（OG 卡片、旧消费方、不支持 srcset 的场景）
    const fallbackWidth = Math.min(THUMBNAIL_WIDTH, sourceWidth)
    const thumbnailBuffer = await sharpInstance
      .clone()
      .resize(fallbackWidth, null, { withoutEnlargement: true })
      .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true })
      .toBuffer()

    await fs.writeFile(thumbnailPath, thumbnailBuffer)

    // 生成 WebP/AVIF 响应式候选
    const { variants } = await buildVariantBuffers(sharpInstance, sourceWidth, photoId)
    await Promise.all(
      variants.map((variant) => fs.writeFile(path.join(THUMBNAIL_DIR, variant.fileName), variant.buffer)),
    )
    await writeThumbnailIndex(photoId, variants)

    // 记录生成信息
    const duration = Date.now() - startTime
    const sizeKB = Math.round(thumbnailBuffer.length / 1024)
    log.success(`生成完成：${photoId} (${sizeKB}KB, ${variants.length} 个候选图, ${duration}ms)`)

    // 基于生成的缩略图生成 blurhash
    const thumbHash = await generateBlurhash(thumbnailBuffer)

    return createSuccessResult(thumbnailUrl, thumbnailBuffer, thumbHash, variants)
  } catch (error) {
    log.error(`生成失败：${photoId}`, error)
    return createFailureResult()
  }
}

/** 自动旋转（EXIF Orientation 5~8）会把宽高互换 */
function rotateWidth(metadata: sharp.Metadata): number {
  const orientation = metadata.orientation ?? 1
  if (orientation >= 5 && orientation <= 8) {
    return metadata.height ?? metadata.width ?? THUMBNAIL_WIDTH
  }
  return metadata.width ?? THUMBNAIL_WIDTH
}

// 生成缩略图和 blurhash（复用 Sharp 实例）
export async function generateThumbnailAndBlurhash(
  imageBuffer: Buffer,
  photoId: string,
  forceRegenerate = false,
): Promise<ThumbnailResult> {
  const thumbnailLog = getGlobalLoggers().thumbnail

  try {
    await ensureThumbnailDir()

    // 如果不是强制模式且缩略图已存在，尝试复用现有文件
    if (!forceRegenerate && (await thumbnailExists(photoId))) {
      const existingResult = await processExistingThumbnail(photoId)

      if (existingResult) {
        return existingResult
      }
      // 如果处理现有缩略图失败，继续生成新的
    }

    // 生成新的缩略图
    return await generateNewThumbnail(imageBuffer, photoId)
  } catch (error) {
    thumbnailLog.error(`处理失败：${photoId}`, error)
    return createFailureResult()
  }
}
