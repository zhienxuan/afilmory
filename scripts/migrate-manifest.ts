import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { migrateManifest } from '../packages/builder/src/manifest/migrate'
import { CURRENT_MANIFEST_VERSION } from '../packages/builder/src/manifest/version'

// 落点锚在本文件位置，不用 process.cwd()：migrate:manifest 挂在根 package.json 上，
// cwd 恒为仓库根，而仓库根从来没有 src/，旧写法 resolve(cwd,'src/data/...') 一次都命不中。
// apps/web 才是 manifest 真正的家（builder 的 workdir 也指向它）。
const manifestPath = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../apps/web/src/data/photos-manifest.json',
)

async function run() {
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed?.version === CURRENT_MANIFEST_VERSION) {
      console.info(`Manifest 已是 ${CURRENT_MANIFEST_VERSION}，跳过迁移`)
      return
    }
    const migrated = migrateManifest(parsed, CURRENT_MANIFEST_VERSION)
    await fs.writeFile(manifestPath, JSON.stringify(migrated, null, 2))
    console.info(`✅ Manifest 迁移完成 -> ${CURRENT_MANIFEST_VERSION}`)
  } catch (e) {
    console.error('❌ 迁移失败：', e)
    console.error(`   落点：${manifestPath}`)
    process.exitCode = 1
  }
}

run()
