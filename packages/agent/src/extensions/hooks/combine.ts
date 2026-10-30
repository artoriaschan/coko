// 外部 Hook 与权限判定的组合（ADR 0013）：同一事件的决定聚合为 deny > ask > allow（项目 Hook 的 allow 不参与），再与 decide 的结果按固定的
// 组合表合并。Hook 的 allow 与一条允许规则同位：只能放行原本要在第 7 步（default）询问的调用。
import type { DecisionStep, PermissionDecision, SteppedDecision } from '../../policy/decide.ts'
import type { HookResult } from './output.ts'
import type { HookDecision, HookSource, HookVerdict } from './types.ts'

const RANK: Record<HookDecision, number> = { allow: 1, ask: 2, deny: 3 }

/** 一条 Hook 的结论与它的来源（聚合用）。 */
export interface SourcedHookResult {
  hookId: string
  source: HookSource
  command: string
  result: HookResult
}

/**
 * 聚合：deny > ask > allow；项目 Hook 的 allow 被忽略（只收紧）。原因取胜出决定的各 Hook 的原因（按配置顺序以换行连接），
 * hookId 与 command 取其中第一条。
 */
export function aggregateVerdict(results: readonly SourcedHookResult[]): HookVerdict {
  let best: HookDecision | undefined
  for (const { source, result } of results) {
    const decision = result.decision
    if (!decision || (decision === 'allow' && source === 'project')) continue
    if (!best || RANK[decision] > RANK[best]) best = decision
  }
  if (!best) return {}
  const winners = results.filter((r) => r.result.decision === best && !(best === 'allow' && r.source === 'project'))
  const reasons = winners.flatMap((r) => (r.result.reason ? [r.result.reason] : []))
  const first = winners[0]!
  return {
    decision: best,
    ...(reasons.length > 0 ? { reason: reasons.join('\n') } : {}),
    source: first.source,
    hookId: first.hookId,
    command: first.command,
  }
}

/** 第 2–4 步（询问规则、受保护路径、越出可写根）：Hook 的 allow 不能免掉。 */
const RULE_STEPS: ReadonlySet<DecisionStep> = new Set(['ask-rule', 'protected', 'outside-writable'])

/** 组合的结果：deny（hook / rule）、询问（hook 的 ask 没有建议规则；policy 的询问按 decide）、或允许。 */
export type CombinedDecision =
  | { behavior: 'deny'; by: 'hook'; reason: string }
  | { behavior: 'deny'; by: 'rule'; decision: Extract<PermissionDecision, { behavior: 'deny' }> }
  | { behavior: 'ask'; by: 'policy'; decision: Extract<PermissionDecision, { behavior: 'ask' }>; step: DecisionStep }
  | { behavior: 'ask'; by: 'hook'; decision: Extract<PermissionDecision, { behavior: 'ask' }>; reason?: string }
  | { behavior: 'allow'; by: 'hook' | 'policy' }

/** Hook 拒绝时交给模型的文本。 */
export const blockedByHookText = (reason: string | undefined) => `Blocked by hook: ${reason?.trim() || 'no reason given'}`

/**
 * 组合表（按顺序）：H = deny → 拒绝；P = deny → 拒绝；P 来自第 2–4 步，或调用为提权或 plan-exit（forced）→ 按 P 询问（H 的 allow 无效）；
 * H = ask → 询问，没有建议规则；H = allow → 允许；其余按 P。forced 时 P 已是询问（plan-exit）或由调用方另行询问（提权）。
 */
export function combinePreToolUse(hook: HookVerdict, policy: SteppedDecision, forced = false): CombinedDecision {
  if (hook.decision === 'deny') return { behavior: 'deny', by: 'hook', reason: blockedByHookText(hook.reason) }
  const { decision, step } = policy
  if (decision.behavior === 'deny') return { behavior: 'deny', by: 'rule', decision }
  if (decision.behavior === 'ask' && (RULE_STEPS.has(step) || forced)) return { behavior: 'ask', by: 'policy', decision, step }
  if (forced) return { behavior: 'allow', by: 'policy' }
  if (hook.decision === 'ask')
    return {
      behavior: 'ask',
      by: 'hook',
      decision: { behavior: 'ask', reason: decision.behavior === 'ask' ? decision.reason : 'approval-required', suggestions: [] },
      ...(hook.reason ? { reason: hook.reason } : {}),
    }
  if (hook.decision === 'allow') return { behavior: 'allow', by: decision.behavior === 'allow' ? 'policy' : 'hook' }
  return decision.behavior === 'allow' ? { behavior: 'allow', by: 'policy' } : { behavior: 'ask', by: 'policy', decision, step }
}
