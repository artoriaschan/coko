// 桌面构建编排：tsdown 构建 main / preload 与 sidecar（node-pty 复制到 sidecar 的 node_modules），Vite 构建或服务 renderer，复制随包 ripgrep。
// Forge hooks、E2E globalSetup 与 `pnpm run build` 共用这里的函数；各任务只清理自己的输出目录。
import { execFileSync } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rgPath } from '@vscode/ripgrep'
import { build as tsdown, type InlineConfig, type TsdownBundle } from 'tsdown'
import { build as viteBuild } from 'vite'
import { createRendererDevServer, type RendererDevServer } from './renderer-dev-server.ts'

export type { RendererDevServer } from './renderer-dev-server.ts'

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

/**
 * 随包的 Electron 与其 Node 版本（renderer 的设置 → 关于）：以 ELECTRON_RUN_AS_NODE 运行本包依赖的 Electron 读取 process.versions，
 * 与打包进应用的二进制一致；renderer 在沙箱中没有 process。
 */
export const runtimeVersionsDefine = (): Record<string, string> => {
  const electronBinary = createRequire(import.meta.url)('electron') as string
  const output = execFileSync(
    electronBinary,
    ['-e', 'process.stdout.write(JSON.stringify({ electron: process.versions.electron, node: process.versions.node }))'],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
    },
  )
  const versions = JSON.parse(output) as { electron: string; node: string }
  return { __COKO_RUNTIME_VERSIONS__: JSON.stringify({ electron: versions.electron, node: versions.node }) }
}

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

/** 开发时的 watch 构建：首次构建成功后 ready 完成；之后每次成功重建调用 onRebuild。 */
export interface DevWatcher {
  readonly ready: Promise<void>
  close(): Promise<void>
}

/**
 * tsdown watch：build() 在 watcher 建立后即返回，首次构建由 build:done 判断。构建失败时 tsdown 记录错误并继续监听，
 * 修复后的下一次成功构建同样算作首次。
 */
function watchConfig(
  config: InlineConfig,
  onFirst: () => void | Promise<void>,
  onRebuild: () => void,
): { started: Promise<TsdownBundle[]>; ready: Promise<void> } {
  let built = false
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const started = tsdown({
    ...config,
    watch: true,
    hooks: {
      'build:done': async () => {
        if (built) return onRebuild()
        built = true
        try {
          await onFirst()
          resolveReady()
        } catch (error) {
          rejectReady(error)
        }
      },
    },
  })
  started.catch(rejectReady)
  return { started, ready }
}

const closeBundles = async (bundles: readonly Promise<TsdownBundle[]>[]): Promise<void> => {
  for (const started of bundles) {
    const list = await started.catch(() => [])
    for (const bundle of list) await bundle[Symbol.asyncDispose]()
  }
}

/** main / preload 的 watch 构建（首次构建由 main 的配置清理 dist/electron）；两者的重建在 200 毫秒内合并为一次 onRebuild。 */
export function watchElectron(onRebuild: () => void): DevWatcher {
  let timer: NodeJS.Timeout | undefined
  const rebuilt = () => {
    clearTimeout(timer)
    timer = setTimeout(onRebuild, 200)
  }
  const define = { ...testBuildDefine(), ...updateFeedDefine() }
  const [mainConfig, preloadConfig] = electronConfigs as [InlineConfig, InlineConfig]
  const main = watchConfig({ ...mainConfig, define }, () => undefined, rebuilt)
  // 顺序与一次性构建相同：main 的首次构建清理目录之后再开始 preload。
  const preloadStarted = main.ready.then(() => watchConfig({ ...preloadConfig, define }, () => undefined, rebuilt))
  return {
    ready: preloadStarted.then((preload) => preload.ready),
    close: async () => {
      clearTimeout(timer)
      await closeBundles([main.started, preloadStarted.then((preload) => preload.started)])
    },
  }
}

/** Sidecar 的 watch 构建：首次构建后复制 node-pty（重建只清理上一次的 chunk，不动 node_modules）；之后每次重建调用 onRebuild。 */
export function watchSidecar(onRebuild: () => void): DevWatcher {
  const sidecar = watchConfig({ ...sidecarConfig, define: testBuildDefine() }, () => copyNodePty().then(() => undefined), onRebuild)
  return { ready: sidecar.ready, close: () => closeBundles([sidecar.started]) }
}

/**
 * 开发时 Sidecar 重建的通知文件（dist/dev，不进安装包）：每次重建后原子替换，main 监视所在目录并计划重启 Sidecar
 * （见 main 的 dev-reload.ts）。经环境变量 COKO_SIDECAR_RELOAD_FILE 交给 main。
 */
export const sidecarReloadFile = join(desktopRoot, 'dist', 'dev', 'sidecar-build')

export async function writeSidecarReloadStamp(): Promise<void> {
  await mkdir(dirname(sidecarReloadFile), { recursive: true })
  const temporary = `${sidecarReloadFile}.${process.pid}.tmp`
  await writeFile(temporary, String(Date.now()))
  await rename(temporary, sidecarReloadFile)
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
  await viteBuild({ configFile: viteConfigFile, logLevel: 'warn', define: runtimeVersionsDefine() })
}

/** Forge 开发入口：使用同一份 renderer 配置和当前 Electron 运行时版本。 */
export async function startRendererDevServer(): Promise<RendererDevServer> {
  return createRendererDevServer(viteConfigFile, runtimeVersionsDefine())
}

if (import.meta.main) {
  await prepareRipgrep()
  await buildSidecar()
  await buildElectron()
  await buildRenderer()
}
