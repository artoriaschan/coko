// ApprovalBroker：每个运行时一个。判定为 ask 的调用在这里等待回答；请求与决定各提交一条 Session Entry。
// 状态：pending → allowed（scope）/ denied（可带反馈）/ cancelled（停止）/ superseded（模式或规则变更后重新判定为
// allow、deny，或仍需询问但原因变了而重新询问）。只能回答一次；没有超时。
import { randomUUID } from 'node:crypto'
import type { ApprovalDecisionPayload, ApprovalRequestPayload, ApprovalScope } from '../session-entries/index.ts'

export class ApprovalNotPendingError extends Error {
  override readonly name = 'ApprovalNotPendingError'
  readonly requestId: string
  constructor(requestId: string) {
    super(`Approval request ${requestId} is not pending`)
    this.requestId = requestId
  }
}

/**
 * 对一个待审批请求的回答。feedback 只随拒绝有效，作为工具错误文本交给模型。reevaluate 由宿主在模式或规则变更后发出：
 * 按当时的模式与规则重新判定，结果为 allow 或 deny 时请求以 superseded 结束，仍需询问时保持等待。
 */
export type ApprovalAnswer = { decision: 'allow'; scope?: ApprovalScope } | { decision: 'deny'; feedback?: string } | { decision: 'reevaluate' }

/**
 * 重新判定的结论：allow / deny 结束请求；reask 结束请求并由等待方按新判定重新询问（原因或可保存的规则变了）；undefined 表示
 * 仍需询问且请求不变。
 */
export type ReevaluateVerdict = { behavior: 'allow' } | { behavior: 'deny'; reason: string } | { behavior: 'reask' } | undefined

/** 请求的结局（等待方据此继续或停止）。 */
export type ApprovalResolution =
  | { outcome: 'allowed'; scope: ApprovalScope }
  | { outcome: 'denied'; feedback?: string }
  | { outcome: 'cancelled' }
  | { outcome: 'superseded'; verdict: Exclude<ReevaluateVerdict, undefined> }

export type ApprovalBrokerEntry =
  | { kind: 'approval_request'; payload: ApprovalRequestPayload }
  | { kind: 'approval_decision'; payload: ApprovalDecisionPayload }

export interface ApprovalBroker {
  /**
   * 提交 approval_request 并等待回答；signal 触发时以 cancelled 结束。决定条目提交完成后才 resolve。
   * 请求或决定的提交失败时 reject。reevaluate 供 `{ decision: 'reevaluate' }` 使用；缺省时该回答不改变请求。
   */
  request(request: Omit<ApprovalRequestPayload, 'requestId'>, signal?: AbortSignal, reevaluate?: () => Promise<ReevaluateVerdict>): Promise<ApprovalResolution>
  /**
   * 回答待审批请求；请求不在等待中时抛 ApprovalNotPendingError。决定条目提交后返回；reevaluate 仍需询问时直接返回。
   */
  answer(requestId: string, answer: ApprovalAnswer): Promise<void>
  /** 按提出顺序的待审批请求。 */
  pending(): ApprovalRequestPayload[]
  /**
   * 不等待用户、由 PermissionRequest Hook 回答的请求（ADR 0013）：依次提交 approval_request 与 approval_decision { outcome: allowed, scope: once,
   * by: hook }；不进入等待表。提交失败时 reject。
   */
  recordHookAllowed(request: Omit<ApprovalRequestPayload, 'requestId'>): Promise<void>
}

/** 反馈交给模型，限制长度。 */
const MAX_FEEDBACK = 4000

export function createApprovalBroker(commit: (entry: ApprovalBrokerEntry) => Promise<void>): ApprovalBroker {
  const waiting = new Map<
    string,
    { payload: ApprovalRequestPayload; settle: (resolution: ApprovalResolution) => Promise<void>; reevaluate: (() => Promise<ReevaluateVerdict>) | undefined }
  >()

  return {
    async request(request, signal, reevaluate) {
      const payload: ApprovalRequestPayload = { requestId: randomUUID(), ...request }
      // 先登记再提交：条目一经发布就可能被回答。决定条目排在请求条目之后提交。
      let requested!: Promise<void>
      const answered = new Promise<ApprovalResolution>((resolve, reject) => {
        const onAbort = () => void settle({ outcome: 'cancelled' }).catch(() => {})
        const settle = async (resolution: ApprovalResolution) => {
          // 同步移出等待表：并发的第二次回答立即得到 not pending。
          if (!waiting.delete(payload.requestId)) return
          signal?.removeEventListener('abort', onAbort)
          try {
            await requested
          } catch (error) {
            reject(error)
            throw error
          }
          const decision: ApprovalDecisionPayload = { requestId: payload.requestId, outcome: resolution.outcome }
          if (resolution.outcome === 'allowed') decision.scope = resolution.scope
          if (resolution.outcome === 'denied' && resolution.feedback !== undefined) decision.feedback = resolution.feedback
          try {
            await commit({ kind: 'approval_decision', payload: decision })
          } catch (error) {
            reject(error)
            throw error
          }
          resolve(resolution)
        }
        waiting.set(payload.requestId, { payload, settle, reevaluate })
        requested = commit({ kind: 'approval_request', payload })
        requested.catch(() => {
          // 请求未能记录：不再等待回答。
          if (waiting.delete(payload.requestId)) signal?.removeEventListener('abort', onAbort)
        })
        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
      })
      await requested
      return answered
    },

    async answer(requestId, answer) {
      const entry = waiting.get(requestId)
      if (!entry) throw new ApprovalNotPendingError(requestId)
      if (answer.decision === 'reevaluate') {
        const verdict = await entry.reevaluate?.()
        // 判定期间请求可能已被回答或取消：settle 对已结束的请求不做任何事。
        if (verdict) await entry.settle({ outcome: 'superseded', verdict })
        return
      }
      if (answer.decision === 'allow') return entry.settle({ outcome: 'allowed', scope: answer.scope ?? 'once' })
      const feedback = answer.feedback?.trim().slice(0, MAX_FEEDBACK)
      return entry.settle(feedback ? { outcome: 'denied', feedback } : { outcome: 'denied' })
    },

    pending: () => [...waiting.values()].map((entry) => entry.payload),

    async recordHookAllowed(request) {
      const payload: ApprovalRequestPayload = { requestId: randomUUID(), ...request }
      await commit({ kind: 'approval_request', payload })
      await commit({ kind: 'approval_decision', payload: { requestId: payload.requestId, outcome: 'allowed', scope: 'once', by: 'hook' } })
    },
  }
}
