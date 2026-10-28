import { defineConfig } from 'tsdown'
import { electronConfigs, sidecarConfig } from './build/build.ts'

// CLI 入口（pnpm exec tsdown）；Forge hooks 直接调用 build/build.ts 的函数。
export default defineConfig([...electronConfigs, sidecarConfig].map((config) => ({ ...config, config: undefined })))
