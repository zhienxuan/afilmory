import path from 'node:path'
import { fileURLToPath } from 'node:url'

// URL.pathname 不解 percent-encoding，仓库路径带空格/中文时会算出 .../sp%20dir/...，
// 下面两个常量跟着变成不存在的路径。
const dirname = path.dirname(fileURLToPath(import.meta.url))
export const MANIFEST_PATH = path.resolve(dirname, '../../../../../packages/data/src/photos-manifest.json')

export const MONOREPO_ROOT_PATH = path.resolve(dirname, '../../../../..')
