// MCP 测试 Server 的路径与辅助函数（集成测试与 E2E 共用）。
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** stdio 测试 Server 的入口（以当前 node 可执行文件启动，Node 原生剥离类型）。 */
export const stdioServerEntry = fileURLToPath(new URL('./stdio-server.ts', import.meta.url))

/** 忽略 stdin 关闭的 stdio 测试 Server（只能被信号终止；孤儿清理用例）。 */
export const stubbornStdioServerEntry = fileURLToPath(new URL('./stubborn-stdio-server.ts', import.meta.url))

/** 启动 stdio 测试 Server 的 MCP 配置（command 为绝对路径，不依赖 PATH）。 */
export function stdioServerConfig(env: Record<string, string> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { command: process.execPath, args: [stdioServerEntry], env, ...extra }
}

/**
 * 假的 npx：在 dir 中写一个可执行的 npx 脚本，把收到的参数原样交给 stdio 测试 Server（启动事件记录 argv）。Sidecar 的 PATH 以 dir 开头时，
 * 浏览器预设（command npx）启动的是它，不从网络下载 Playwright MCP。env 写进脚本（例如 MCP_FIXTURE_FEATURES=screenshot、MCP_FIXTURE_LOG）。
 */
export async function fakeNpx(dir: string, env: Record<string, string> = {}): Promise<string> {
  await mkdir(dir, { recursive: true })
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const exports = Object.entries(env).map(([name, value]) => `export ${name}=${quote(value)}`)
  const path = join(dir, 'npx')
  await writeFile(path, ['#!/bin/sh', ...exports, `exec ${quote(process.execPath)} ${quote(stdioServerEntry)} "$@"`, ''].join('\n'))
  await chmod(path, 0o755)
  return dir
}

export { startHttpFixture, type HttpFixture, type HttpFixtureAuth } from './http-server.ts'
export { FIXTURE_SCREENSHOT_PNG } from './server-core.ts'
