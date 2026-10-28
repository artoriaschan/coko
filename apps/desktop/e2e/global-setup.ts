import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * 运行 `pnpm run package`（electron-forge package）：prePackage hook 构建 dist/ripgrep、dist/sidecar、dist/electron、
 * dist/renderer，供未打包路径的用例使用；out/ 中的应用供产物 smoke 使用。一次构建，两类用例读取同一份产物。
 * COKO_TEST_BUILD=1 打出测试构建：产物 smoke 需要的 COKO_FAUX_SCRIPT 在打包产物中才生效（发布构建会剥离它）。
 */
export default async function setup(): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, COKO_TEST_BUILD: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['run', 'package'], { cwd: desktopRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output = (output + chunk).slice(-16_384)))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output = (output + chunk).slice(-16_384)))
    child.once('error', reject)
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`pnpm run package exited with ${String(code)}\n${output}`))))
  })
}
