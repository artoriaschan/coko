/**
 * 发布构建 E2E 的 globalSetup：以 COKO_FORGE_OUT_DIR=out-release、不带 COKO_TEST_BUILD 运行 `pnpm run make`，用例读取 out-release/ 中的
 * 打包应用与 make/ 中的 .zip / .dmg。只在 COKO_RELEASE_E2E=1 时由 vitest.release.config.ts 装配。安装包的 makers 与 make 脚本接入之前，
 * 本骨架只核对开关并说明缺少的步骤。
 */
export default async function setup(): Promise<void> {
  if (process.env.COKO_RELEASE_E2E !== '1') return
  throw new Error('release E2E: the make step (pnpm run make with COKO_FORGE_OUT_DIR=out-release) is not wired yet')
}
