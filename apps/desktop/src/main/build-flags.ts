import { TEST_HOOK_ENV, type BuildKind } from './sidecar-env.ts'

/**
 * 构建期标志：`COKO_TEST_BUILD=1` 时 apps/desktop/build/build.ts 把 __COKO_TEST_BUILD__ 定义为 true，打出供 E2E 与产物 smoke
 * 使用的测试构建；发布构建为 false。未经打包直接运行源码时（单元测试）标识符不存在，按 false 处理。
 */
declare const __COKO_TEST_BUILD__: boolean | undefined
/** 构建期的自动更新源（build.ts 由 COKO_UPDATE_FEED_URL 定义，缺省空）。更新源属于发布方，不是用户设置。 */
declare const __COKO_UPDATE_FEED__: string | undefined

export const TEST_BUILD: boolean = typeof __COKO_TEST_BUILD__ === 'boolean' ? __COKO_TEST_BUILD__ : false
export const UPDATE_FEED: string = typeof __COKO_UPDATE_FEED__ === 'string' ? __COKO_UPDATE_FEED__ : ''

/** 测试构建另读的更新源（E2E 的本地 feed 服务器）；发布构建忽略它。 */
export const TEST_UPDATE_FEED_ENV = 'COKO_TEST_UPDATE_FEED_URL'

/** 实际使用的更新源：测试构建中 COKO_TEST_UPDATE_FEED_URL 非空时用它，否则只用构建期的值。 */
export function resolveUpdateFeed(env: NodeJS.ProcessEnv, options: { testBuild: boolean; buildFeed: string }): string {
  const override = options.testBuild ? env[TEST_UPDATE_FEED_ENV] : undefined
  return override !== undefined && override !== '' ? override : options.buildFeed
}

/** main 自身读取的测试钩子（E2E 后台模式与调试显示）；其余测试钩子与交给 Sidecar 的相同（TEST_HOOK_ENV）。 */
const MAIN_TEST_HOOK_ENV = /^COKO_E2E_(?:BACKGROUND|VISIBLE)$/

/** 打包的发布构建中被忽略的测试钩子变量名（按名字排序；只列名字，不含值）。未打包或测试构建时为空。 */
export function ignoredTestHooks(env: NodeJS.ProcessEnv, kind: BuildKind): string[] {
  if (!kind.packaged || kind.testBuild) return []
  return Object.keys(env)
    .filter((key) => env[key] !== undefined && (TEST_HOOK_ENV.test(key) || MAIN_TEST_HOOK_ENV.test(key)))
    .sort()
}
