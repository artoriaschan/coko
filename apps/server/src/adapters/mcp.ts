// MCP 传输（docs/subsystems/mcp.md）：stdio 与 streamable HTTP（pi-mcp）。stdio 的环境 = 过滤后的 Sidecar 环境（与 bash 相同的 HOST_ENV_EXCLUSIONS，
// 不含 ELECTRON_RUN_AS_NODE、COKO_*、凭据形态的变量）+ 配置 env（其中的 ${NAME} 已由调用方从登记的 Secret 展开）；工作目录缺省为
// Workspace，配置 cwd 相对 Workspace。关闭时 pi-mcp 先关 stdin，再 SIGTERM，2 秒后 SIGKILL。stdio 进程不套 Seatbelt。
import { resolve } from 'node:path'
import { filterEnv, type McpServerConfig, type McpTransportHandle } from '@coko/agent'
import { StdioTransport, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import { HOST_ENV_EXCLUSIONS } from './credentials.ts'

export interface McpTransportOptions {
  /** Workspace 目录。 */
  cwd: string
  /** Sidecar 自身的环境。 */
  env: Readonly<Record<string, string | undefined>>
}

export function createMcpTransport(config: McpServerConfig, options: McpTransportOptions): McpTransportHandle {
  if ('url' in config) return { transport: new StreamableHttpTransport({ url: config.url, ...(config.headers ? { headers: config.headers } : {}) }) }
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(filterEnv(options.env, HOST_ENV_EXCLUSIONS))) if (value !== undefined) env[name] = value
  Object.assign(env, config.env)
  const transport = new StdioTransport({
    command: config.command,
    args: config.args ?? [],
    cwd: resolve(options.cwd, config.cwd ?? '.'),
    env,
    inheritEnv: false,
    stderr: 'pipe',
  })
  return { transport, stderr: () => transport.stderr, pid: () => transport.pid }
}
