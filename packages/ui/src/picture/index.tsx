import type { ThumbnailFormat, ThumbnailVariant } from '@afilmory/typing'
import { buildSrcSet, getSrcSetFormats } from '@afilmory/utils'
import { useMemo } from 'react'

export interface PictureSourcesProps {
  /** manifest 上的多档候选，缺失时整块不渲染，<img> 的兜底 JPEG 照旧生效 */
  variants?: ThumbnailVariant[]
  /** 与 <img sizes> 保持一致，告诉浏览器这一格实际多宽 */
  sizes?: string
}

/**
 * 把候选集摊成 <source type> 列表，交给浏览器按格式与显示宽度自选。
 * 只出 avif/webp —— 兜底 JPEG 由 <img src> 承担。
 */
export const PictureSources = ({ variants, sizes }: PictureSourcesProps) => {
  const sources = useMemo(
    () =>
      getSrcSetFormats(variants)
        .map((format) => ({ format, srcSet: buildSrcSet(variants, format) }))
        .filter((source): source is { format: ThumbnailFormat; srcSet: string } => Boolean(source.srcSet)),
    [variants],
  )

  return (
    <>
      {sources.map((source) => (
        <source key={source.format} type={`image/${source.format}`} srcSet={source.srcSet} sizes={sizes} />
      ))}
    </>
  )
}
