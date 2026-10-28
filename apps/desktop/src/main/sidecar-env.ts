/**
 * 只供测试的 Sidecar 环境变量（替换 sandbox-exec、注册测试工具、挂起工具结果、faux provider）。打包的发布构建在启动
 * Sidecar 时去掉它们，Sidecar 收到 --packaged 后也不读取（apps/server 的 config.ts），两侧各守一道。
 */
export const TEST_HOOK_ENV = /^COKO_(?:SANDBOX_EXEC|TEST_[A-Z0-9_]+|FAUX_SCRIPT)$/

export interface BuildKind {
  /** app.isPackaged。 */
  packaged: boolean
  /** 构建期标志 COKO_TEST_BUILD=1 打出的测试构建（E2E 与产物 smoke 使用）。 */
  testBuild: boolean
}

/** 交给 Sidecar 的环境：打包的发布构建去掉测试钩子变量，其余原样保留。 */
export function sidecarEnvironment(env: NodeJS.ProcessEnv, kind: BuildKind): NodeJS.ProcessEnv {
  if (!kind.packaged || kind.testBuild) return env
  return Object.fromEntries(Object.entries(env).filter(([key]) => !TEST_HOOK_ENV.test(key)))
}

/** 打包时追加 --packaged：Sidecar 据此只在测试构建中读取测试钩子。 */
export function sidecarArgs(args: readonly string[], kind: Pick<BuildKind, 'packaged'>): string[] {
  return kind.packaged ? [...args, '--packaged'] : [...args]
}
