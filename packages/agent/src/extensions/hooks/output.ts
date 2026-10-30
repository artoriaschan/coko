// Hook 进程结果的解释（ADR 0013）：exit 2 为阻断（stderr 为原因）；exit 0 时 stdout 可以是 JSON 决定（字段名沿用 claude-code）；超时、
// 非 0 非 2 的退出、exit 0 而 stdout 不是合法 JSON（PreCompact 除外）都没有决定。只有有结果的执行带 outcome（据此提交 hook_run）。
import type { HookDecision, HookEvent, HookOutcome } from './types.ts'

/** 一次执行的原始结果（宿主的 Hook 执行端口给出）。 */
export interface HookProcessResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
  /** 启动失败等宿主错误。 */
  error?: string
}

/** 一条 Hook 的结论。 */
export interface HookResult {
  /** 有结果的执行的结论（提交 hook_run）；没有决定的成功执行省略。 */
  outcome?: HookOutcome
  /** 工具事件（PreToolUse、PermissionRequest）的决定。 */
  decision?: HookDecision
  /** 拒绝或询问的原因（交给模型或显示给用户）。 */
  reason?: string
  /** 追加给模型的文本（PostToolUse 的 additionalContext 或 exit 2 的 stderr；其他事件的 additionalContext）。 */
  context?: string
  /** 非工具事件的阻断（exit 2 或 decision: block）。 */
  block?: boolean
  /** continue: false：本批完成后停止。 */
  stop?: boolean
  stopReason?: string
  /** 只显示给用户的文本（hook_run.message）。 */
  systemMessage?: string
  /** PreCompact：stdout 文本（追加为摘要要求）。 */
  text?: string
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : undefined)

/** 决定对应的 hook_run outcome。 */
const decisionOutcome: Record<HookDecision, HookOutcome> = { deny: 'blocked', ask: 'asked', allow: 'allowed' }

function toolDecision(event: HookEvent, json: Record<string, unknown>): { decision?: HookDecision; reason?: string; invalid?: boolean } {
  const specific = isObject(json.hookSpecificOutput) ? json.hookSpecificOutput : {}
  if (event === 'PermissionRequest') {
    const decision = specific.decision
    if (decision === undefined) return {}
    if (!isObject(decision) || (decision.behavior !== 'allow' && decision.behavior !== 'deny')) return { invalid: true }
    const reason = str(decision.message)
    return { decision: decision.behavior, ...(reason ? { reason } : {}) }
  }
  const permission = specific.permissionDecision
  const reason = str(specific.permissionDecisionReason) ?? str(json.reason)
  if (permission !== undefined) {
    if (permission !== 'allow' && permission !== 'deny' && permission !== 'ask') return { invalid: true }
    return { decision: permission, ...(reason ? { reason } : {}) }
  }
  // 旧写法：decision approve / block。
  if (json.decision === 'block') return { decision: 'deny', ...(reason ? { reason } : {}) }
  if (json.decision === 'approve') return { decision: 'allow', ...(reason ? { reason } : {}) }
  if (json.decision !== undefined) return { invalid: true }
  return {}
}

/** 解释一条 Hook 的执行结果。 */
export function interpretHookResult(event: HookEvent, result: HookProcessResult): HookResult {
  if (result.error !== undefined) return { outcome: 'error', reason: result.error }
  if (result.timedOut) return { outcome: 'timeout' }
  const stderr = result.stderr.trim()
  if (result.exitCode === 2) {
    if (event === 'PostToolUse' || event === 'PostToolUseFailure') return stderr ? { outcome: 'context', context: stderr } : {}
    if (event === 'PreToolUse' || event === 'PermissionRequest') return { outcome: 'blocked', decision: 'deny', ...(stderr ? { reason: stderr } : {}) }
    return { outcome: 'blocked', block: true, ...(stderr ? { reason: stderr } : {}) }
  }
  if (result.exitCode !== 0) return { outcome: 'error', ...(stderr ? { reason: stderr } : {}) }
  const stdout = result.stdout.trim()
  if (stdout === '') return {}
  if (event === 'PreCompact') return { outcome: 'context', text: stdout }
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return { outcome: 'invalid-output' }
  }
  if (!isObject(json)) return { outcome: 'invalid-output' }
  const out: HookResult = {}
  const systemMessage = str(json.systemMessage)
  if (systemMessage) out.systemMessage = systemMessage
  if (json.continue === false) {
    out.stop = true
    const stopReason = str(json.stopReason)
    if (stopReason) out.stopReason = stopReason
  }
  const specific = isObject(json.hookSpecificOutput) ? json.hookSpecificOutput : {}
  const context = str(specific.additionalContext)
  if (event === 'PreToolUse' || event === 'PermissionRequest') {
    const decided = toolDecision(event, json)
    if (decided.invalid) return { outcome: 'invalid-output' }
    if (decided.decision) {
      out.decision = decided.decision
      if (decided.reason) out.reason = decided.reason
      out.outcome = event === 'PermissionRequest' && decided.decision === 'deny' ? 'denied' : decisionOutcome[decided.decision]
    }
  } else {
    if (context) {
      out.context = context
      out.outcome = 'context'
    }
    if (json.decision === 'block') {
      out.block = true
      const reason = str(json.reason)
      if (reason) out.reason = reason
      out.outcome = 'blocked'
    }
  }
  if (out.stop) out.outcome = 'stopped'
  return out
}
