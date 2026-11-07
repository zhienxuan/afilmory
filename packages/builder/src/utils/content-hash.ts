import crypto from 'node:crypto'

/**
 * 产物内容指纹长度。
 * 短到不啰嗦，也足够避免同一张照片换了内容后覆盖同名文件。
 */
export const CONTENT_HASH_LENGTH = 8

/**
 * 计算产物的内容指纹（sha256 前 8 位）。
 *
 * 缩略图和 OG 图的文件名都掺这个指纹，做到内容寻址：
 * 内容一变 URL 就变，上游 `immutable` 长缓存才不会把旧内容钉死。
 */
export function contentHashOf(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, CONTENT_HASH_LENGTH)
}
