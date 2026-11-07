#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/** docs 在 77f1649 从 packages/docs 整包搬到 apps/docs */
const REPO_ROOT = join(__dirname, '..')
const CONTENTS_DIR = join(REPO_ROOT, 'apps', 'docs', 'contents')
const CONTENTS_DIR_REL = relative(REPO_ROOT, CONTENTS_DIR).replaceAll('\\', '/')

/**
 * Update lastModified field in MDX files
 */
function updateLastModified(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8')

    // Check if the file has frontmatter
    if (!content.startsWith('---')) {
      console.info(`Skipping ${filePath}: no frontmatter found`)
      return false
    }

    // Parse frontmatter
    const frontmatterEnd = content.indexOf('---', 3)
    if (frontmatterEnd === -1) {
      console.info(`Skipping ${filePath}: invalid frontmatter format`)
      return false
    }

    const frontmatter = content.slice(0, frontmatterEnd + 3)
    const body = content.slice(frontmatterEnd + 3)

    // Check if lastModified field exists
    if (!frontmatter.includes('lastModified:')) {
      console.info(`Skipping ${filePath}: no lastModified field found`)
      return false
    }

    // Generate new timestamp
    const currentDate = new Date()
      .toLocaleString('en-GB', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      .replace(
        /(\d{2})\/(\d{2})\/(\d{4}), (\d{2}:\d{2}:\d{2})/,
        '$3-$2-$1T$4+08:00',
      )

    // Update lastModified field
    const updatedFrontmatter = frontmatter.replace(
      /lastModified:[ \t]*[^\n]*$/m,
      `lastModified: ${currentDate}`,
    )

    const updatedContent = updatedFrontmatter + body
    writeFileSync(filePath, updatedContent, 'utf-8')

    console.info(`✅ Updated ${filePath} lastModified to ${currentDate}`)
    return true
  } catch (error) {
    console.error(`❌ Failed to update ${filePath}:`, error)
    return false
  }
}

/**
 * Get modified documentation files
 */
function getModifiedDocsFiles(): string[] {
  try {
    // 用 -z 拿 NUL 分隔的原始路径：core.quotepath 默认 true 时 --name-only 会把
    // 非 ASCII 文件名转成八进制转义串，startsWith / endsWith 双双落空、静默漏刷。
    // --diff-filter=d 拦的是 `git rm --cached`（索引 D、文件还在盘上）：这种路径
    // 过得了 existsSync，进了 add 名单就会把刚摘掉的索引项原地复活，删除白做。
    // 工作区真删掉的条目 existsSync 那层就挡了，走不到 add，不用这里兜。
    const stagedFiles = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=d'], {
      encoding: 'utf-8',
      cwd: REPO_ROOT,
    })
      .split('\0')
      .filter(Boolean)

    // Filter for md/mdx files in docs contents directory
    const docsFiles = stagedFiles.filter(
      (file) =>
        file.startsWith(`${CONTENTS_DIR_REL}/`) &&
        (file.endsWith('.md') || file.endsWith('.mdx')),
    )

    // 索引里有改动、工作区已删（`MD`）/ 新增暂存后又删（`AD`）：--diff-filter=d 按
    // 索引对 HEAD 判定，这两种算 M / A，排不掉。它们进了循环只会 readFileSync 抛
    // ENOENT，一条刷一屏栈。add 收窄成「真写盘的」之后它们已经进不了索引（早先
    // 整批 add 会把索引项摘掉，那才是真丢东西），在这层滤掉，省掉这屏噪音。
    return docsFiles.map((file) => join(REPO_ROOT, file)).filter((file) => existsSync(file))
  } catch (error) {
    console.error('Failed to get modified files:', error)
    return []
  }
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2)

  // If file paths are provided as arguments, process them directly
  if (args.length > 0) {
    let hasUpdates = false
    for (const filePath of args) {
      if (updateLastModified(filePath)) {
        hasUpdates = true
      }
    }

    if (hasUpdates) {
      console.info('\n📝 Please check updates and re-add to staging area:')
      console.info(`git add ${CONTENTS_DIR_REL}/`)
    }
    return
  }

  // Get modified documentation files
  const modifiedFiles = getModifiedDocsFiles()

  if (modifiedFiles.length === 0) {
    console.info('✨ No documentation files need updating')
    return
  }

  console.info(`🔍 Found ${modifiedFiles.length} modified documentation files:`)
  modifiedFiles.forEach((file) => console.info(`  - ${file}`))

  // 只把真正写盘的文件塞回暂存区。跳过的（无 frontmatter / 无 lastModified）
  // 本来就该原样留在暂存区外：跟着 add 一遍会把它们尚未暂存的改动卷进这次提交。
  // 边界：这里对齐的是**文件**粒度，不是行粒度。被刷的文件自身若还有未暂存的
  // 改动，writeFileSync 已经把工作区那份整个写回去了，再整文件 add 就一并进索引。
  // 要做到行粒度得拿索引版本重算新内容、git hash-object -w + update-index --cacheinfo，
  // 为一个自动刷时间戳的脚本不值当。
  const updatedFiles = modifiedFiles.filter((filePath) => updateLastModified(filePath))

  if (updatedFiles.length > 0) {
    console.info(
      '\n📝 Auto-updated lastModified fields, re-adding to staging area...',
    )
    try {
      // 传数组走 execFile，不过 shell：仓库路径带空格也不会拼错
      execFileSync('git', ['add', '--', ...updatedFiles], {
        stdio: 'inherit',
        cwd: REPO_ROOT,
      })
      console.info('✅ Successfully re-added to staging area')
    } catch (error) {
      console.error('❌ Failed to re-add to staging area:', error)
      console.info(`Please run manually: git add ${CONTENTS_DIR_REL}/`)
    }
  }
}

// Run main function
main()
