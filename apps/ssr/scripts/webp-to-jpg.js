import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

// URL.pathname 不解 percent-encoding，仓库路径带空格/中文时会得到 .../sp%20dir/...，
// 拼出来的缩略图目录根本不存在。
const __dirname = dirname(fileURLToPath(import.meta.url))
// 定义目标目录
const thumbnailsDir = join(__dirname, '../public/thumbnails')

// 转换 WebP 到 JPG 的函数
async function convertWebpToJpg(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .jpeg({ quality: 90 }) // 设置 JPG 质量为 90
      .toFile(outputPath)
    console.info(`✅ 转换成功：${basename(inputPath)} -> ${basename(outputPath)}`)
  } catch (error) {
    console.error(`❌ 转换失败：${basename(inputPath)}`, error.message)
  }
}

// 递归处理目录
async function processDirectory(dirPath) {
  try {
    const items = readdirSync(dirPath)

    for (const item of items) {
      const fullPath = join(dirPath, item)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        // 递归处理子目录
        await processDirectory(fullPath)
      } else if (stat.isFile() && extname(item).toLowerCase() === '.webp') {
        // 处理 WebP 文件
        const baseName = basename(item, '.webp')
        const outputPath = join(dirPath, `${baseName}.jpg`)

        await convertWebpToJpg(fullPath, outputPath)
      }
    }
  } catch (error) {
    console.error(`❌ 处理目录失败：${dirPath}`, error.message)
  }
}

// 主函数
async function main() {
  console.info('🚀 开始转换 WebP 图片到 JPG...')
  console.info(`📁 目标目录：${thumbnailsDir}`)

  // 目录不建就 throw 属于「指望别人先准备好」：apps/ssr/public/** 被 .gitignore 排除，
  // 干净 checkout 上它本来就不存在，带不带空格都一样。
  if (!existsSync(thumbnailsDir)) {
    mkdirSync(thumbnailsDir, { recursive: true })
    console.info(`📁 已创建目标目录：${thumbnailsDir}`)
  }

  try {
    await processDirectory(thumbnailsDir)
    console.info('✨ 所有转换任务完成！')
  } catch (error) {
    console.error('❌ 转换过程中发生错误：', error.message)
    throw error
  }
}

main()
