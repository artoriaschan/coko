/**
 * 恢复 node-pty 预编译 spawn-helper 的可执行位。
 *
 * npm 包发布时会丢掉该文件的可执行位，pnpm 解包后 macOS 上 spawn 会以 posix_spawnp failed 失败。
 * 没有安装 node-pty（如只安装部分 workspace）时什么也不做。
 */

import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(join(process.cwd(), 'apps', 'server', 'package.json'))

let packageRoot
try {
  packageRoot = dirname(require.resolve('node-pty/package.json'))
} catch {
  process.exit(0)
}

const candidates = [
  join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
  join(packageRoot, 'build', 'Release', 'spawn-helper'),
]

for (const helper of candidates) {
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
