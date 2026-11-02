// 观测（docs/subsystems/tracing.md）：由已提交的条目派生的追踪与审计，以及会话导出（application/x-ndjson）。派生是 @coko/agent 的纯函数；
// 这里只读取条目、按登记明文再脱敏一次（响应与导出是新的输出通道；用户自己输入的文本在库中按原样保存，导出时同样替换，ADR 0007），
// 并按 ?children=1 递归收集子 Session。
import { deriveAudit, deriveTrace, formatExport, sessionExportHeader, traceTotals, type SessionExportEntry } from '@coko/agent'
import { redactSecretsDeep } from '@coko/logging'
import type { AuditResponse, TraceResponse } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { requireSession } from './session-runtimes.ts'

export interface TraceServiceOptions {
  store: Pick<SessionStore, 'sessions'>
  /** 导出 header 的 exportedAt（测试时钟）。缺省 Date.now。 */
  now?: () => number
}

export interface SessionExport {
  /** 下载的文件名（coko-session-<id>.ndjson）。 */
  filename: string
  text: string
}

export class TraceService {
  readonly #options: TraceServiceOptions

  constructor(options: TraceServiceOptions) {
    this.#options = options
  }

  async #entries(sessionId: string) {
    const store = this.#options.store as SessionStore
    await requireSession(store, sessionId)
    return store.sessions.listEntries(sessionId)
  }

  async trace(sessionId: string): Promise<TraceResponse> {
    const entries = await this.#entries(sessionId)
    const runs = deriveTrace(entries)
    const totals = traceTotals(runs)
    for (const entry of entries) {
      if (entry.kind !== 'model_request') continue
      const payload = entry.payload as unknown as import('@coko/protocol').ModelRequestPayload
      if (payload.purpose !== 'title' || payload.runId !== null) continue
      totals.requests++
      totals.tokens += payload.usage.total
      totals.cost += payload.cost ?? 0
    }
    return redactSecretsDeep({ runs, totals }) satisfies TraceResponse
  }

  async audit(sessionId: string): Promise<AuditResponse> {
    return redactSecretsDeep(deriveAudit(await this.#entries(sessionId))) satisfies AuditResponse
  }

  /** header + 本 Session 的条目；children 时其后按派生顺序（深度优先）为各子 Session 的条目。 */
  async export(sessionId: string, options: { children?: boolean } = {}): Promise<SessionExport> {
    const store = this.#options.store as SessionStore
    const entries: SessionExportEntry[] = [...(await this.#entries(sessionId))]
    if (options.children) {
      const visit = async (parentId: string) => {
        for (const child of await store.sessions.listChildren(parentId)) {
          entries.push(...(await store.sessions.listEntries(child.id)))
          await visit(child.id)
        }
      }
      await visit(sessionId)
    }
    const header = sessionExportHeader(sessionId, (this.#options.now ?? Date.now)())
    return { filename: `coko-session-${sessionId}.ndjson`, text: formatExport(header, redactSecretsDeep(entries)) }
  }
}
