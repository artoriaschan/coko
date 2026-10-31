// 代码智能（语言服务器）的应用服务：配置（lsp.servers 与 Workspace 的服务器）、进程状态与 lsp 工具的端口。当前为空实现：没有配置的服务器，
// 没有进程；关闭时没有要停止的进程（有序关闭在"关闭上下文贡献"之后、"终止登记进程"之前调用 close）。
import type { LspResponse } from '@coko/protocol'
import type { ConfigService } from './config.ts'
import { AppError } from './errors.ts'

export interface LspServiceOptions {
  config: Pick<ConfigService, 'effective'>
}

export class LspService {
  readonly #options: LspServiceOptions

  constructor(options: LspServiceOptions) {
    this.#options = options
  }

  /** GET /api/lsp：能力开关、空的全局配置与状态。 */
  async get(): Promise<LspResponse> {
    const effective = await this.#options.config.effective()
    return { enabled: effective.lsp.enabled, global: { servers: {}, revision: 0, diagnostics: [] }, status: [] }
  }

  /** PUT /api/lsp 与 POST /api/lsp/restart 尚未接入：501 not-implemented。 */
  notImplemented(): never {
    throw new AppError('not-implemented', 'Language server configuration is not available yet')
  }

  /** 停止全部语言服务器进程（shutdown → exit → SIGTERM → SIGKILL）。 */
  async close(): Promise<void> {}
}
