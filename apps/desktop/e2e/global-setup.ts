import { buildElectron, buildRenderer } from '../build/build.ts'

export default async function setup(): Promise<void> {
  // 占位 sidecar 由 COKO_SIDECAR_ENTRY 指定，不需要构建 apps/server。
  await buildElectron()
  await buildRenderer()
}
