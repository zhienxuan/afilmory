import fs from 'node:fs/promises'
import path from 'node:path'

import { workdir } from '@afilmory/builder/path.js'
import type { ThumbnailFormat, ThumbnailResult, ThumbnailVariantFile } from '@afilmory/typing'
import sharp from 'sharp'

import { getGlobalLoggers } from '../photo/logger-adapter.js'
import { CONTENT_HASH_LENGTH, contentHashOf } from '../utils/content-hash.js'
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
const INDEX_SUFFIX = '.thumbs.json'

/**
 * 缩略图缓存索引，与图片文件同目录。
 *
 * 图片文件名里带内容指纹（内容寻址），索引本身按 photoId 落盘：
 * 内容不变就直接复用，内容一变文件名和 URL 一起变，
 * 上层那条 `immutable` 长缓存才真的站得住。
 */
export interface ThumbnailIndex {
  contentHash: string
  /** JPEG 兜底缩略图文件名 */
  fallbackFileName: string
  variants: Array<{
    fileName: string
    width: number
    format: ThumbnailFormat
    contentType: string
  }>
}

function getIndexPath(photoId: string) {
  return path.join(THUMBNAIL_DIR, `${photoId}${INDEX_SUFFIX}`)
}

function getFallbackFileName(photoId: string, contentHash: string) {
  return `${photoId}-${contentHash}.${FALLBACK_EXTENSION}`
}

function getVariantFileName(photoId: string, contentHash: string, width: number, extension: string) {
  return `${photoId}-${contentHash}-${width}w.${extension}`
}

/**
 * 从缩略图文件名还原 photoId，用于清理废弃产物与删除已删除照片的缓存。
 * 支持 `{id}-{hash}.jpg`、`{id}-{hash}-{width}w.{avif|webp}`、`{id}.thumbs.json`，
 * 以及更早的 `{id}.jpg` / `{id}-{width}w.{avif|webp}`。
 */
export function extractPhotoIdFromThumbnail(fileName: string): string {
  const withoutIndexSuffix = fileName.endsWith(INDEX_SUFFIX)
    ? fileName.slice(0, -INDEX_SUFFIX.length)
    : path.basename(fileName, path.extname(fileName))

  return withoutIndexSuffix.replace(/-\d+w$/, '').replace(new RegExp(`-[0-9a-f]{${CONTENT_HASH_LENGTH}}$`), '')
}

/**
 * 文件名可能对应的所有 photoId 候选（由严到宽）。
 *
 * 剥指纹是启发式的：照片 id 本身可能就以 `-deadbeef` 这类 8 位十六进制结尾。
 * 所以「这个文件还有没有主」的判断不能只看一个结果 —— 逐个候选去 manifest 里查，
 * 有一个命中就说明文件不是孤儿。
 */
export function candidatePhotoIdsFromThumbnail(fileName: string): string[] {
  const withoutIndexSuffix = fileName.endsWith(INDEX_SUFFIX)
    ? fileName.slice(0, -INDEX_SUFFIX.length)
    : path.basename(fileName, path.extname(fileName))

  const withoutWidth = withoutIndexSuffix.replace(/-\d+w$/, '')
  const withoutHash = withoutWidth.replace(new RegExp(`-[0-9a-f]{${CONTENT_HASH_LENGTH}}$`), '')

  return [...new Set([withoutIndexSuffix, withoutWidth, withoutHash, extractPhotoIdFromThumbnail(fileName)])]
}

// 创建失败结果
function createFailureResult(): ThumbnailResult {
  return {
    thumbnailUrl: null,
    thumbnailFileName: null,
    thumbnailBuffer: null,
    thumbHash: null,
    thumbnailVariants: [],
  }
}

// 创建成功结果
function createSuccessResult(
  thumbnailFileName: string,
  thumbnailBuffer: Buffer,
  thumbHash: Uint8Array | null,
  thumbnailVariants: ThumbnailVariantFile[],
): ThumbnailResult {
  return {
    thumbnailUrl: `/thumbnails/${thumbnailFileName}`,
    thumbnailFileName,
    thumbnailBuffer,
    thumbHash,
    thumbnailVariants,
  }
}

// 确保缩略图目录存在
async function ensureThumbnailDir(): Promise<void> {
  await fs.mkdir(THUMBNAIL_DIR, { recursive: true })
}

/**
 * 读取缩略图缓存索引。
 * 空候选数组是合法状态（原图窄于最窄档位），只要兜底图在，缓存就算完整。
 */
export async function readThumbnailIndex(photoId: string): Promise<ThumbnailIndex | null> {
  try {
    const raw = await fs.readFile(getIndexPath(photoId), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<ThumbnailIndex>
    if (typeof parsed?.fallbackFileName !== 'string' || parsed.fallbackFileName.length === 0) {
      return null
    }
    if (!Array.isArray(parsed.variants)) {
      return null
    }
    return {
      contentHash: typeof parsed.contentHash === 'string' ? parsed.contentHash : '',
      fallbackFileName: parsed.fallbackFileName,
      variants: parsed.variants,
    }
  } catch {
    return null
  }
}

async function writeThumbnailIndex(
  photoId: string,
  contentHash: string,
  fallbackFileName: string,
  variants: ThumbnailVariantFile[],
): Promise<void> {
  const index: ThumbnailIndex = {
    contentHash,
    fallbackFileName,
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
 * 缩略图缓存是否命中。
 *
 * 判据只有两个：索引里登记的文件都在，且索引记录的内容指纹与照片当前内容一致。
 * 候选集为空不算问题 —— 原图窄于最窄档位时本来就不该产出候选，
 * 只要兜底图在，这张照片的缓存就是完整的。
 *
 * @param expectedDigest manifest 上的内容摘要（完整 sha256），传了就用来核对内容有没有变
 */
export async function thumbnailCacheValid(photoId: string, expectedDigest?: string | null): Promise<boolean> {
  const index = await readThumbnailIndex(photoId)
  if (!index) {
    return false
  }

  if (expectedDigest && index.contentHash && !expectedDigest.startsWith(index.contentHash)) {
    return false
  }

  const fileNames = [index.fallbackFileName, ...index.variants.map((variant) => variant.fileName)]
  try {
    await Promise.all(fileNames.map((fileName) => fs.access(path.join(THUMBNAIL_DIR, fileName))))
    return true
  } catch {
    return false
  }
}

async function buildVariantBuffers(
  sharpInstance: sharp.Sharp,
  sourceWidth: number,
  photoId: string,
  contentHash: string,
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

      const fileName = getVariantFileName(photoId, contentHash, width, extension)
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

/**
 * 清掉这张照片的旧产物（内容变过之后指纹就变了，旧格式产物也没有指纹）。
 * 匹配走严格模式：`{id}-{hash}...` 或旧的 `{id}[-{width}w].{ext}`，
 * 这样 `abc` 的清理不会误伤 `abc-1` 或 `abcd` 这种靠前缀撞上的照片。
 */
async function pruneStaleThumbnailFiles(photoId: string, keep: Set<string>): Promise<void> {
  const id = escapeRegExp(photoId)
  const owned = new RegExp(
    [`^${id}-[0-9a-f]{${CONTENT_HASH_LENGTH}}(-\\d+w)?\\.[\\w]+$`, `^${id}(-\\d+w)?\\.(?:jpe?g|avif|webp)$`].join('|'),
  )
  const entries = await fs.readdir(THUMBNAIL_DIR).catch(() => [] as string[])

  await Promise.all(
    entries.map(async (fileName) => {
      if (keep.has(fileName) || !owned.test(fileName)) return
      await fs.unlink(path.join(THUMBNAIL_DIR, fileName)).catch(() => undefined)
    }),
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface CachedThumbnailFiles {
  thumbnailFileName: string
  thumbnailBuffer: Buffer
  variants: ThumbnailVariantFile[]
}

/**
 * 按索引把磁盘上的缩略图读回内存（含候选图 buffer），供复用路径与存储插件使用。
 *
 * 传了 `expectedContentHash` 时会核对索引里的指纹：照片同名换了内容就判为不命中，
 * 让它重新生成一套新文件名的产物 —— 少了这道核对，内容寻址就只是改了个名字。
 * 索引缺失或文件不全时返回 null，调用方应回退到重新生成。
 */
export async function readCachedThumbnailFiles(
  photoId: string,
  expectedContentHash?: string,
): Promise<CachedThumbnailFiles | null> {
  const index = await readThumbnailIndex(photoId)
  if (!index) {
    return null
  }

  if (expectedContentHash && index.contentHash && index.contentHash !== expectedContentHash) {
    return null
  }

  try {
    const thumbnailBuffer = await fs.readFile(path.join(THUMBNAIL_DIR, index.fallbackFileName))

    const variants: ThumbnailVariantFile[] = []
    for (const variant of index.variants) {
      variants.push({
        ...variant,
        buffer: await fs.readFile(path.join(THUMBNAIL_DIR, variant.fileName)),
        localUrl: `/thumbnails/${variant.fileName}`,
      })
    }

    return { thumbnailFileName: index.fallbackFileName, thumbnailBuffer, variants }
  } catch {
    return null
  }
}

// 读取现有缩略图并生成 blurhash
async function processExistingThumbnail(photoId: string, contentHash: string): Promise<ThumbnailResult | null> {
  const thumbnailLog = getGlobalLoggers().thumbnail
  thumbnailLog.info(`复用现有缩略图：${photoId}`)

  try {
    const cached = await readCachedThumbnailFiles(photoId, contentHash)
    if (!cached) {
      return null
    }

    const thumbHash = await generateBlurhash(cached.thumbnailBuffer)
    return createSuccessResult(cached.thumbnailFileName, cached.thumbnailBuffer, thumbHash, cached.variants)
  } catch (error) {
    thumbnailLog?.warn(`读取现有缩略图失败，重新生成：${photoId}`, error)
    return null
  }
}

// 生成新的缩略图
async function generateNewThumbnail(imageBuffer: Buffer, photoId: string): Promise<ThumbnailResult> {
  const log = getGlobalLoggers().thumbnail
  log.info(`生成缩略图：${photoId}`)
  const startTime = Date.now()

  try {
    // 文件名带内容指纹：内容变了 URL 一定变，长缓存才敢下手
    const contentHash = contentHashOf(imageBuffer)
    const fallbackFileName = getFallbackFileName(photoId, contentHash)

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

    await fs.writeFile(path.join(THUMBNAIL_DIR, fallbackFileName), thumbnailBuffer)

    // 生成 WebP/AVIF 响应式候选
    const { variants } = await buildVariantBuffers(sharpInstance, sourceWidth, photoId, contentHash)
    await Promise.all(
      variants.map((variant) => fs.writeFile(path.join(THUMBNAIL_DIR, variant.fileName), variant.buffer)),
    )
    await writeThumbnailIndex(photoId, contentHash, fallbackFileName, variants)

    await pruneStaleThumbnailFiles(
      photoId,
      new Set([`${photoId}${INDEX_SUFFIX}`, fallbackFileName, ...variants.map((variant) => variant.fileName)]),
    )

    // 记录生成信息
    const duration = Date.now() - startTime
    const sizeKB = Math.round(thumbnailBuffer.length / 1024)
    log.success(`生成完成：${photoId} (${sizeKB}KB, ${variants.length} 个候选图, ${duration}ms)`)

    // 基于生成的缩略图生成 blurhash
    const thumbHash = await generateBlurhash(thumbnailBuffer)

    return createSuccessResult(fallbackFileName, thumbnailBuffer, thumbHash, variants)
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

    // 如果不是强制模式且缓存对得上（文件在 + 内容没变），直接复用
    if (!forceRegenerate) {
      const existingResult = await processExistingThumbnail(photoId, contentHashOf(imageBuffer))
      if (existingResult) {
        return existingResult
      }
      // 缓存不命中就走下面的生成逻辑
    }

    // 生成新的缩略图
    return await generateNewThumbnail(imageBuffer, photoId)
  } catch (error) {
    thumbnailLog.error(`处理失败：${photoId}`, error)
    return createFailureResult()
  }
}
