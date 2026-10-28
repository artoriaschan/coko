// 桌面构建编排：tsdown 构建 main / preload 与 sidecar，Vite 构建或服务 renderer，复制随包 ripgrep。
// Forge hooks、E2E globalSetup 与 `pnpm run build` 共用这里的函数；各任务只清理自己的输出目录。
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rgPath } from '@vscode/ripgrep'
import { build as tsdown, type InlineConfig } from 'tsdown'
import { build as viteBuild, createServer as createViteServer } from 'vite'

export const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
// renderer 唯一的 Vite 配置：base './'，输出 dist/renderer；生产构建与开发服务器共用。
const viteConfigFile = fileURLToPath(new URL('../src/renderer/vite.config.ts', import.meta.url))

const electronBase: InlineConfig = {
  config: false,
  cwd: desktopRoot,
  outDir: 'dist/electron',
  format: 'cjs',
  fixedExtension: true,
  platform: 'node',
  target: 'node24.14',
  dts: false,
  deps: { neverBundle: ['electron'], onlyBundle: false },
  // Electron 加载 main / preload 只支持 CommonJS（sandbox preload 无 ESM），忽略 tsdown 的 ESM 建议。
  logLevel: 'error',
}

/**
 * Electron main 与 sandbox preload：各自是 CommonJS 单文件，只保留 electron 与 Node 内置模块为 external。
 * 分开构建以免产生共享 chunk：sandbox preload 的 require 只能解析 electron 等少数模块。
 */
export const electronConfigs: InlineConfig[] = [
  { ...electronBase, entry: { main: 'src/main/index.ts' }, clean: true },
  { ...electronBase, entry: { preload: 'src/preload/index.ts' }, clean: false },
]

/**
 * Sidecar：apps/server 的进程入口，ESM，以 ELECTRON_RUN_AS_NODE 运行，不得导入 electron。构建归属在 apps/desktop
 * （@coko/server 是本包的 workspace 依赖），apps/server 自身不输出产物，见 architecture.md 的构建与测试归属。
 */
export const sidecarConfig: InlineConfig = {
  config: false,
  cwd: desktopRoot,
  entry: { index: '../server/src/index.ts' },
  outDir: 'dist/sidecar',
  format: 'esm',
  fixedExtension: true,
  platform: 'node',
  target: 'node24.14',
  dts: false,
  clean: true,
  deps: { onlyBundle: false },
  logLevel: 'warn',
}

export async function buildElectron(): Promise<void> {
  // 顺序执行：第一个配置负责清理 dist/electron。
  for (const config of electronConfigs) await tsdown(config)
}

export async function buildSidecar(): Promise<void> {
  await tsdown(sidecarConfig)
}

/**
 * 把 @vscode/ripgrep 为当前平台解析的 rg 复制到 dist/ripgrep：开发时 main 从这里取，打包时经 extraResource
 * 放到 Resources/ripgrep。@vscode/ripgrep 是 ESM 且按自身位置解析平台包，不能打进 CommonJS main。
 */
export async function prepareRipgrep(): Promise<string> {
  const outDir = join(desktopRoot, 'dist', 'ripgrep')
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const target = join(outDir, basename(rgPath))
  await copyFile(rgPath, target)
  await chmod(target, 0o755)
  return target
}

export async function buildRenderer(): Promise<void> {
  await viteBuild({ configFile: viteConfigFile, logLevel: 'warn' })
}

export interface RendererDevServer {
  /** http://127.0.0.1:<port>，经环境变量 COKO_RENDERER_DEV_URL 交给 main。 */
  readonly url: string
  close(): Promise<void>
}

/** 开发服务器：先在端口 0 监听拿到实际端口，再以 middleware 模式挂载 Vite，HMR 复用同一端口。 */
export async function startRendererDevServer(): Promise<RendererDevServer> {
  const http = createHttpServer()
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('Unexpected dev server address')
  const vite = await createViteServer({
    configFile: viteConfigFile,
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server: http, host: '127.0.0.1', clientPort: address.port, protocol: 'ws' } },
  })
  http.on('request', vite.middlewares)
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await vite.close()
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}

if (import.meta.main) {
  await prepareRipgrep()
  await buildSidecar()
  await buildElectron()
  await buildRenderer()
}
