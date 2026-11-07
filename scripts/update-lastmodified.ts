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
    // --diff-filter=d 排掉已删除的条目：`git add -- <已删路径>` 是硬 fatal，
    // 一条就够整批暂存失败，没删的文件一起进不去。
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

    // 索引里有改动、工作区已删（git status 的 `MD`）：--diff-filter=d 按索引对 HEAD
    // 判定，这种算 M 排不掉。而 `git add -- <该路径>` 在 MD 态不报错、exit 0，
    // 却把这条的索引项一起摘掉 —— 用户已暂存的修改会静默消失。必须在此拦掉。
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
