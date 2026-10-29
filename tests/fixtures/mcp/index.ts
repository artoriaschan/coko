// MCP 测试 Server 的路径与辅助函数（集成测试与 E2E 共用）。
import { fileURLToPath } from 'node:url'

/** stdio 测试 Server 的入口（以当前 node 可执行文件启动，Node 原生剥离类型）。 */
export const stdioServerEntry = fileURLToPath(new URL('./stdio-server.ts', import.meta.url))

/** 启动 stdio 测试 Server 的 MCP 配置（command 为绝对路径，不依赖 PATH）。 */
export function stdioServerConfig(env: Record<string, string> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { command: process.execPath, args: [stdioServerEntry], env, ...extra }
}

export { startHttpFixture, type HttpFixture } from './http-server.ts'
