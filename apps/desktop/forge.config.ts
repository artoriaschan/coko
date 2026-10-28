import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import type { ForgeConfig } from '@electron-forge/shared-types'
import { buildElectron, buildRenderer, buildSidecar, startRendererDevServer, type RendererDevServer } from './build/build.ts'

let devServer: RendererDevServer | undefined

/** 应用文件只含 package.json 与 main / preload / renderer 产物；sidecar 经 extraResource 放在 Resources/sidecar。 */
const KEEP = ['/package.json', '/dist', '/dist/electron', '/dist/renderer']
const ignore = (file: string): boolean => {
  if (file === '') return false
  return !KEEP.some((kept) => file === kept || (kept !== '/dist' && file.startsWith(kept + '/')))
}

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Coko',
    executableName: 'Coko',
    appBundleId: 'dev.coko.desktop',
    asar: true,
    extraResource: ['dist/sidecar'],
    ignore,
  },
  makers: [],
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
      await buildSidecar()
      await buildElectron()
      await buildRenderer()
    },
  },
}

export default config
