// 观测：由条目派生的追踪、审计与会话导出。当前为空实现：trace 与 audit 为空，导出为 501。
import type { AuditResponse, TraceResponse } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { AppError } from './errors.ts'
import { requireSession } from './session-runtimes.ts'

export interface TraceServiceOptions {
  store: Pick<SessionStore, 'sessions'>
}

export class TraceService {
  readonly #options: TraceServiceOptions

  constructor(options: TraceServiceOptions) {
    this.#options = options
  }

  async trace(sessionId: string): Promise<TraceResponse> {
    await requireSession(this.#options.store as SessionStore, sessionId)
    return { runs: [], totals: { requests: 0, tokens: 0, cost: 0, durationMs: 0 } }
  }

  async audit(sessionId: string): Promise<AuditResponse> {
    await requireSession(this.#options.store as SessionStore, sessionId)
    return []
  }

  /** GET /api/sessions/:id/export 尚未接入：501 not-implemented。 */
  async export(sessionId: string): Promise<never> {
    await requireSession(this.#options.store as SessionStore, sessionId)
    throw new AppError('not-implemented', 'Session export is not available yet')
  }
}
