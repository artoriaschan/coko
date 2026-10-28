import { buildElectron, buildRenderer, buildSidecar } from '../build/build.ts'

export default async function setup(): Promise<void> {
  // 对话场景使用随应用构建的真实 Sidecar（dist/sidecar）；壳层测试的占位 sidecar 由 COKO_SIDECAR_ENTRY 指定。
  await buildSidecar()
  await buildElectron()
  await buildRenderer()
}
