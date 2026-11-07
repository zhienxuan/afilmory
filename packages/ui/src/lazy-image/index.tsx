import { Thumbhash } from '@afilmory/ui'
import { clsxm } from '@afilmory/utils'
import { useCallback, useState } from 'react'
import { useInView } from 'react-intersection-observer'

export interface LazyImageProps {
  src: string
  alt: string
  thumbHash?: string | null
  className?: string
  style?: React.CSSProperties
  /** 响应式候选集，原样透传给 <img srcSet> */
  srcSet?: string
  /** 候选集的尺寸描述，用于告诉浏览器该选哪一档 */
  sizes?: string
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
  srcSet,
  sizes,
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

  return (
    <div ref={ref} className={clsxm('relative overflow-hidden', className)} style={style}>
      {/* Thumbhash placeholder */}
      {thumbHash && !isLoaded && <Thumbhash thumbHash={thumbHash} className="absolute inset-0 scale-110 blur-sm" />}

      {/* Actual image */}
      {shouldLoadImage && (
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
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-800">
          <span className="text-sm text-gray-500 dark:text-gray-400">Failed to load image</span>
        </div>
      )}
    </div>
  )
}
