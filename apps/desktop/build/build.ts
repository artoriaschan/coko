// 桌面构建编排：tsdown 构建 main / preload 与 sidecar（node-pty 复制到 sidecar 的 node_modules），Vite 构建或服务 renderer，复制随包 ripgrep。
// Forge hooks、E2E globalSetup 与 `pnpm run build` 共用这里的函数；各任务只清理自己的输出目录。
import { chmod, copyFile, cp, mkdir, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rgPath } from '@vscode/ripgrep'
import { build as tsdown, type InlineConfig } from 'tsdown'
import { build as viteBuild, createServer as createViteServer } from 'vite'

export const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
// renderer 唯一的 Vite 配置：base './'，输出 dist/renderer；生产构建与开发服务器共用。
const viteConfigFile = fileURLToPath(new URL('../src/renderer/vite.config.ts', import.meta.url))

/**
 * 构建期标志（main 与 Sidecar 的 build-flags.ts）：COKO_TEST_BUILD=1 时打出测试构建，打包产物仍接受 COKO_FAUX_SCRIPT 等
 * 测试钩子（E2E 的 globalSetup 这样打包）；否则为发布构建，打包产物剥离并忽略它们。
 */
export const testBuildDefine = (): Record<string, string> => ({ __COKO_TEST_BUILD__: JSON.stringify(process.env.COKO_TEST_BUILD === '1') })

/**
 * 自动更新源（main 的 build-flags.ts 读取）：只来自构建期的 COKO_UPDATE_FEED_URL（更新源属于发布方，不是用户设置），缺省为空（不检查更新）。
 */
export const updateFeedDefine = (): Record<string, string> => ({ __COKO_UPDATE_FEED__: JSON.stringify(process.env.COKO_UPDATE_FEED_URL ?? '') })

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
 * headless 是无界面运行的入口（dist/sidecar/headless.mjs），与 Sidecar 共用同一组 chunk。
 */
export const sidecarConfig: InlineConfig = {
  config: false,
  cwd: desktopRoot,
  entry: { index: '../server/src/index.ts', headless: '../server/src/headless/index.ts' },
  outDir: 'dist/sidecar',
  format: 'esm',
  fixedExtension: true,
  platform: 'node',
  target: 'node24.14',
  dts: false,
  clean: true,
  // node-pty 是原生模块：不打进产物，运行时从 dist/sidecar/node_modules 加载（copyNodePty）。
  deps: { neverBundle: ['node-pty'], onlyBundle: false },
  logLevel: 'warn',
}

export async function buildElectron(): Promise<void> {
  // 顺序执行：第一个配置负责清理 dist/electron。
  for (const config of electronConfigs) await tsdown({ ...config, define: { ...testBuildDefine(), ...updateFeedDefine() } })
}

export async function buildSidecar(): Promise<void> {
  await tsdown({ ...sidecarConfig, define: testBuildDefine() })
  await copyNodePty()
}

/**
 * 把 apps/server 解析到的 node-pty 的运行所需部分（package.json、LICENSE、lib/ 与当前平台的 prebuilds/<platform>-<arch>/）复制到
 * dist/sidecar/node_modules/node-pty：sidecar 的 index.mjs 按 Node 的解析规则从相邻的 node_modules 加载它。spawn-helper 设为 0755
 * （npm 包会丢失可执行位）。sidecar 经 extraResource 放在 Resources/sidecar，不在 asar 内，不需要 asar 解包。
 */
export async function copyNodePty(): Promise<string> {
  const serverRequire = createRequire(join(desktopRoot, '..', 'server', 'package.json'))
  const source = dirname(serverRequire.resolve('node-pty/package.json'))
  const target = join(desktopRoot, 'dist', 'sidecar', 'node_modules', 'node-pty')
  const prebuilds = join('prebuilds', `${process.platform}-${process.arch}`)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await Promise.all(['package.json', 'LICENSE'].map((file) => copyFile(join(source, file), join(target, file))))
  await cp(join(source, 'lib'), join(target, 'lib'), { recursive: true, filter: (path) => !/\.(test\.js|map)$/.test(path) })
  await cp(join(source, prebuilds), join(target, prebuilds), { recursive: true })
  if (process.platform !== 'win32') await chmod(join(target, prebuilds, 'spawn-helper'), 0o755)
  return target
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
