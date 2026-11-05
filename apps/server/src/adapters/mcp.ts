// MCP 传输（docs/subsystems/mcp.md）：stdio 与 streamable HTTP（pi-mcp）。stdio 的环境 = 过滤后的 Sidecar 环境（与 bash 相同的 HOST_ENV_EXCLUSIONS，
// 不含 ELECTRON_RUN_AS_NODE、COKO_*、凭据形态的变量）+ 配置 env（其中的 ${NAME} 已由调用方从登记的 Secret 展开）+ 宿主 COKO_MCP_DATA_DIR；工作目录缺省为
// Server 数据目录，配置 cwd 仍相对 Workspace。关闭时 pi-mcp 先关 stdin，再 SIGTERM，2 秒后 SIGKILL。stdio 进程不套 Seatbelt。
// 子进程登记（ADR 0012；docs/subsystems/execution.md）：stdio 传输启动成功后经 onProcess 登记其 pid（宿主同时登记进程组：pi-mcp 以 detached 启动），
// 传输关闭后释放。
import { resolve } from 'node:path'
import { filterEnv, type McpServerConfig, type McpTransportHandle } from '@coko/agent'
import { StdioTransport, StreamableHttpTransport, type AuthProvider } from '@earendil-works/pi-mcp'
import { HOST_ENV_EXCLUSIONS } from './credentials.ts'

export interface McpTransportOptions {
  /** Workspace 目录。 */
  cwd: string
  /** 宿主按 Server 分配的持久化目录，缺省 cwd 与 COKO_MCP_DATA_DIR 使用它。 */
  dataDir: string
  /** Sidecar 自身的环境。 */
  env: Readonly<Record<string, string | undefined>>
  /** stdio Server 启动后调用（pid 与可执行文件），返回的函数在传输关闭后调用一次。 */
  onProcess?: (process: { pid: number; command: string }) => () => void
  /** HTTP：连接给出的 authProvider（401 时连接进入 auth-required）；stdio 不用。 */
  authProvider?: AuthProvider
}

/** 启动成功后报告 pid、关闭后释放的 stdio 传输。 */
class TrackedStdioTransport extends StdioTransport {
  readonly #onProcess: NonNullable<McpTransportOptions['onProcess']>
  readonly #command: string

  constructor(options: ConstructorParameters<typeof StdioTransport>[0], onProcess: NonNullable<McpTransportOptions['onProcess']>) {
    super(options)
    this.#onProcess = onProcess
    this.#command = options.command
  }

  override async start(): Promise<void> {
    await super.start()
    const pid = this.pid
    if (pid === undefined) return
    // 子进程的 close 是异步事件，晚于这里注册的监听。
    const release = this.#onProcess({ pid, command: this.#command })
    this.onClose(release)
  }
}

export function createMcpTransport(config: McpServerConfig, options: McpTransportOptions): McpTransportHandle {
  if ('url' in config)
    return {
      transport: new StreamableHttpTransport({
        url: config.url,
        ...(config.headers ? { headers: config.headers } : {}),
        ...(options.authProvider ? { authProvider: options.authProvider } : {}),
      }),
    }
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(filterEnv(options.env, HOST_ENV_EXCLUSIONS))) if (value !== undefined) env[name] = value
  Object.assign(env, config.env)
  env.COKO_MCP_DATA_DIR = options.dataDir
  const stdio = {
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd === undefined ? options.dataDir : resolve(options.cwd, config.cwd),
    env,
    inheritEnv: false,
    stderr: 'pipe',
  } as const
  const transport = options.onProcess ? new TrackedStdioTransport(stdio, options.onProcess) : new StdioTransport(stdio)
  return { transport, stderr: () => transport.stderr, pid: () => transport.pid }
}
