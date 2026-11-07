import type { ThumbnailVariant } from '@afilmory/typing'
import { clsxm } from '@afilmory/utils'
import { useCallback, useState } from 'react'
import { useInView } from 'react-intersection-observer'

import { PictureSources } from '../picture'
import { Thumbhash } from '../thumbhash'

export interface LazyImageProps {
  src: string
  alt: string
  thumbHash?: string | null
  className?: string
  style?: React.CSSProperties
  /** manifest 上的多档候选，给了就按格式自动摊成 <source> */
  variants?: ThumbnailVariant[]
  /** 候选集的尺寸描述，用于告诉浏览器该选哪一档 */
  sizes?: string
  /** 响应式候选集，需要手写 srcset 时用；给了 variants 就不用它 */
  srcSet?: string
  /** 首屏图片可传 high，让浏览器提前调度 */
  fetchPriority?: 'high' | 'low' | 'auto'
  onLoad?: () => void
  onError?: () => void
  // Intersection observer options
  rootMargin?: string
  threshold?: number
}

export const LazyImage = ({
  src,
  alt,
  thumbHash,
  className,
  style,
  variants,
  sizes,
  srcSet,
  fetchPriority,
  onLoad,
  onError,
  rootMargin = '50px',
  threshold = 0.1,
}: LazyImageProps) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin,
    threshold,
  })

  const handleLoad = useCallback(() => {
    setIsLoaded(true)
    onLoad?.()
  }, [onLoad])

  const handleError = useCallback(() => {
    setHasError(true)
    onError?.()
  }, [onError])

  const shouldLoadImage = inView && !hasError

  const image = (
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      fetchPriority={fetchPriority}
      alt={alt}
      className={clsxm(
        'h-full w-full object-cover transition-opacity duration-300',
        isLoaded ? 'opacity-100' : 'opacity-0',
      )}
      onLoad={handleLoad}
      onError={handleError}
      loading="lazy"
    />
  )

  return (
    <div ref={ref} className={clsxm('relative overflow-hidden', className)} style={style}>
      {/* Thumbhash placeholder */}
      {thumbHash && !isLoaded && <Thumbhash thumbHash={thumbHash} className="absolute inset-0 scale-110 blur-sm" />}

      {/* Actual image */}
      {shouldLoadImage &&
        (variants?.length ? (
          // display:contents 让 <picture> 不参与布局，图片仍按原样铺满父容器
          <picture className="contents">
            <PictureSources variants={variants} sizes={sizes} />
            {image}
          </picture>
        ) : (
          image
        ))}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-800">
          <span className="text-sm text-gray-500 dark:text-gray-400">Failed to load image</span>
        </div>
      )}
    </div>
  )
}
