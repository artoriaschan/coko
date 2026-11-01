import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerZIP } from '@electron-forge/maker-zip'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildElectron, buildRenderer, buildSidecar, prepareRipgrep, startRendererDevServer, type RendererDevServer } from './build/build.ts'

let devServer: RendererDevServer | undefined

/** 应用文件只含 package.json 与 main / preload / renderer 产物；sidecar 与 rg 经 extraResource 放在 Resources/sidecar、Resources/ripgrep。 */
const KEEP = ['/package.json', '/dist', '/dist/electron', '/dist/renderer']
const ignore = (file: string): boolean => {
  if (file === '') return false
  return !KEEP.some((kept) => file === kept || (kept !== '/dist' && file.startsWith(kept + '/')))
}

const config: ForgeConfig = {
  // COKO_FORGE_OUT_DIR 改变产物目录（缺省 out）：发布构建 E2E 打到 out-release/，不覆盖测试构建 E2E 使用的 out/。
  outDir: process.env.COKO_FORGE_OUT_DIR || 'out',
  packagerConfig: {
    name: 'Coko',
    executableName: 'Coko',
    appBundleId: 'dev.coko.desktop',
    asar: true,
    extraResource: ['dist/sidecar', 'dist/ripgrep'],
    ignore,
    // electron-packager 默认在系统临时目录的固定子目录里组装应用；多个 worktree 同时打包会互相删除对方的文件。
    // 每个检出按自身路径使用独立的临时目录。它不能位于应用目录内，否则 packager 会把目录复制进自身。
    tmpdir: path.join(
      tmpdir(),
      'coko-packager-' +
        createHash('sha256')
          .update(fileURLToPath(import.meta.url))
          .digest('hex')
          .slice(0, 12),
    ),
  },
  // ZIP 是自动更新（Squirrel.Mac）下载的格式，DMG 供首次安装；只做 darwin。签名与公证不在当前范围。
  makers: [new MakerZIP({}, ['darwin']), new MakerDMG({ format: 'ULFO' })],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      // main 以 ELECTRON_RUN_AS_NODE 启动 sidecar，必须保持开启；风险见 ADR 0001。
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    preStart: async () => {
      // Forge 启动 Electron 时会删除 ELECTRON_RUN_AS_NODE；sidecar 由 main 单独设置。
      await prepareRipgrep()
      await buildSidecar()
      await buildElectron()
      devServer = await startRendererDevServer()
      process.env.COKO_RENDERER_DEV_URL = devServer.url
    },
    postStart: async (_config, appProcess) => {
      appProcess.once('exit', () => {
        if (appProcess.restarted) return
        void devServer?.close()
        devServer = undefined
      })
    },
    prePackage: async () => {
      await prepareRipgrep()
      await buildSidecar()
      await buildElectron()
      await buildRenderer()
    },
  },
}

export default config
