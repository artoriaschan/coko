/**
 * 构建期标志：`COKO_TEST_BUILD=1` 时 apps/desktop/build/build.ts 把 __COKO_TEST_BUILD__ 定义为 true，打出供 E2E 与产物 smoke
 * 使用的测试构建；发布构建为 false。未经打包直接运行源码时（单元测试）标识符不存在，按 false 处理。
 */
declare const __COKO_TEST_BUILD__: boolean | undefined

export const TEST_BUILD: boolean = typeof __COKO_TEST_BUILD__ === 'boolean' ? __COKO_TEST_BUILD__ : false
