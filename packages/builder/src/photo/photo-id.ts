import crypto from 'node:crypto'
import path from 'node:path'

/**
 * 由 S3 键推导 photoId。
 * `digestSuffixLength > 0` 时在文件名后追加 S3 键摘要，用于同名不同路径的照片区分。
 * 缩略图文件名与 manifest 的 id 都以它为准，所以这里必须是唯一的推导入口。
 */
export function resolvePhotoId(s3Key: string, digestSuffixLength: number | undefined): string {
  const baseName = path.basename(s3Key, path.extname(s3Key))
  if (!digestSuffixLength || digestSuffixLength <= 0) {
    return baseName
  }

  const digestSuffix = crypto.createHash('sha256').update(s3Key).digest('hex').slice(0, digestSuffixLength)
  return `${baseName}_${digestSuffix}`
}
