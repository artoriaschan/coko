// 语言服务器客户端：JSON-RPC 2.0 over stdio（Content-Length 分帧）、initialize / initialized、整篇文档同步、请求超时与关闭序列。
// 当前只有端口的形状；进程以 host_processes 的 lsp 类别登记（ADR 0012）。

export interface LspClientOptions {
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  cwd: string
  initializationOptions?: unknown
  startupTimeoutMs?: number
}

export interface LspClient {
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>
  notify(method: string, params: unknown): void
  close(): Promise<void>
}

export type LspClientFactory = (options: LspClientOptions) => Promise<LspClient>

export const createLspClient: LspClientFactory = async () => {
  throw new Error('The language server client is not implemented')
}
