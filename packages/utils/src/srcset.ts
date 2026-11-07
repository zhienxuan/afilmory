import type { ThumbnailFormat, ThumbnailVariant } from '@afilmory/typing'

/**
 * 把候选集按格式拼成 srcset 字符串，供 <source srcSet> / <img srcSet> 使用。
 * 同格式内按宽度升序，浏览器会自己挑最合适的一档。
 */
export function buildSrcSet(variants: ThumbnailVariant[] | undefined, format: ThumbnailFormat): string | undefined {
  const candidates = (variants ?? [])
    .filter((variant) => variant.format === format && Boolean(variant.url))
    .sort((a, b) => a.width - b.width)

  if (candidates.length === 0) {
    return undefined
  }

  return candidates.map((variant) => `${variant.url} ${variant.width}w`).join(', ')
}

/** 候选集里出现过的格式，按「体积优先」排序（AVIF → WebP） */
export function getSrcSetFormats(variants: ThumbnailVariant[] | undefined): ThumbnailFormat[] {
  const present = new Set((variants ?? []).map((variant) => variant.format))
  const ordered: ThumbnailFormat[] = []
  if (present.has('avif')) ordered.push('avif')
  if (present.has('webp')) ordered.push('webp')
  return ordered
}
