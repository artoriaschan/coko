import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
/** 发布构建的产物目录（COKO_FORGE_OUT_DIR）；与测试构建的 out/ 分开，两类 E2E 不互相覆盖打包结果。 */
export const RELEASE_OUT_DIR = 'out-release'

/**
 * 发布构建 E2E 的 globalSetup：以 COKO_FORGE_OUT_DIR=out-release、不带 COKO_TEST_BUILD 与 COKO_UPDATE_FEED_URL 运行 `pnpm run make`，
 * 用例读取 out-release/ 中的打包应用与 make/ 中的 .zip / .dmg。只在 COKO_RELEASE_E2E=1 时由 vitest.release.config.ts 装配。
 * prePackage hook 同样重建 dist/（发布构建的标志）；之后运行测试构建 E2E 时其 globalSetup 会重新打测试构建。
 */
export default async function setup(): Promise<void> {
  if (process.env.COKO_RELEASE_E2E !== '1') return
  const env: NodeJS.ProcessEnv = { ...process.env, COKO_FORGE_OUT_DIR: RELEASE_OUT_DIR }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'COKO_TEST_BUILD', 'COKO_UPDATE_FEED_URL']) delete env[key]
  // 只清理本项目自己的产物目录（明确路径）。
  await rm(join(desktopRoot, RELEASE_OUT_DIR), { recursive: true, force: true })
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['run', 'make'], { cwd: desktopRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output = (output + chunk).slice(-16_384)))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output = (output + chunk).slice(-16_384)))
    child.once('error', reject)
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`pnpm run make exited with ${String(code)}\n${output}`))))
  })
}
