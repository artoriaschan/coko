// 启动恢复（recovery.md）：从已提交的条目判定一个被中断的 Run（有 run_start 而无 run_end），给出要补提交的条目。
// 只看已提交的记录与当前文件状态，不重跑任何调用。条目按 toolCallId 关联（tool_exec、file_backup 与 toolResult 可以不相邻）。
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { Value } from 'typebox/value'
import type { RunEntry } from '../engine/types.ts'
import type { ApprovalRequestPayload, ConfirmationAnswerPayload } from '../session-entries/index.ts'
import type { CokoTool, ToolOutcome } from '../tools/types.ts'

/** planRecovery 读取的已提交条目（结构上与 @coko/session 的 SessionEntry 相容）。 */
export interface RecoveryEntry {
  seq: number
  kind: string
  runId: string | null
  payload: unknown
}

export interface RecoveryOptions {
  /** 被中断的 Run。 */
  runId: string
  /** 按名称取当前注册的工具；取不到的按 side-effect 处理且无法探测。 */
  tool: (name: string) => CokoTool | undefined
  /** Workspace 目录，交给 probeOutcome。 */
  cwd: string
  /** toolResult 的时间戳；默认 Date.now。 */
  now?: () => number
}

/** 交给模型的结果文本。开头的词（Not run / Interrupted / Applied / Not applied / Outcome unknown）供界面与测试识别。 */
export const RECOVERY_TEXT = {
  notRun: 'Not run: Coko stopped (the app or its service exited) before this call started. It had no effect.',
  approvalExpired: 'Not run: Coko stopped while this call was waiting for approval; the approval request expired. It had no effect.',
  interruptedRead: 'Interrupted: Coko stopped while this call was running and its output was lost. It has no side effects, so you can retry it.',
  probedApplied: 'Applied: Coko stopped before this call reported back, but the current state shows that it took effect. Its output was lost.',
  probedNotApplied: 'Not applied: Coko stopped while this call was running, and the current state shows that it did not take effect.',
  confirmedApplied: 'Applied (confirmed by the user): Coko stopped before this call reported back; its output was lost.',
  confirmedNotApplied: 'Not applied (confirmed by the user): Coko stopped while this call was running and it did not take effect.',
  confirmedUnknown:
    'Outcome unknown: Coko stopped while this call was running and the user could not tell whether it took effect. Before relying on it or running it again, check the current state.',
} as const

interface ToolCallBlock {
  id: string
  name: string
  arguments: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function toolCallsOf(payload: unknown): ToolCallBlock[] {
  if (!isRecord(payload) || payload.role !== 'assistant' || !Array.isArray(payload.content)) return []
  return payload.content.flatMap((block: unknown) =>
    isRecord(block) && block.type === 'toolCall' && typeof block.id === 'string' && typeof block.name === 'string'
      ? [{ id: block.id, name: block.name, arguments: block.arguments }]
      : [],
  )
}

function toolResult(call: { id: string; name: string }, text: string, isError: boolean, now: () => number): ToolResultMessage {
  return { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text }], isError, timestamp: now() }
}

/** 按工具自己的参数准备与 schema 校验后探测；不合格、没有探测或探测失败都是 unknown。 */
async function probe(tool: CokoTool | undefined, args: unknown, cwd: string): Promise<ToolOutcome> {
  if (!tool?.probeOutcome) return 'unknown'
  try {
    const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args
    if (!Value.Check(tool.parameters, prepared)) return 'unknown'
    const outcome = await tool.probeOutcome(prepared as never, cwd)
    return outcome === 'applied' || outcome === 'not-applied' ? outcome : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * 被中断的 Run 要补提交的条目，按提交顺序。对 Run 内每个没有 toolResult 的调用：
 * - 审批仍在等待 → approval_decision expired，并补"未执行"结果；
 * - 没有 tool_exec：read 调用补"已中断，可重试"（read 不提交执行记录，可能已在运行），其余补"未执行"；
 * - 有 tool_exec：工具的 probeOutcome 给出明确结论时按结论补结果，否则提交 confirmation_request 等待用户。
 * 最后是 run_end interrupted。全部条目带该 Run 的 runId。
 */
export async function planRecovery(entries: readonly RecoveryEntry[], options: RecoveryOptions): Promise<RunEntry[]> {
  const { runId, cwd } = options
  const now = options.now ?? Date.now
  const inRun = entries.filter((e) => e.runId === runId)
  const calls: ToolCallBlock[] = []
  const answered = new Set<string>()
  const executed = new Set<string>()
  const requests = new Map<string, ApprovalRequestPayload>()
  const decided = new Set<string>()
  for (const entry of inRun) {
    const payload = entry.payload
    if (entry.kind === 'message') {
      calls.push(...toolCallsOf(payload))
      if (isRecord(payload) && payload.role === 'toolResult' && typeof payload.toolCallId === 'string') answered.add(payload.toolCallId)
    } else if (entry.kind === 'tool_exec' && isRecord(payload) && typeof payload.toolCallId === 'string') executed.add(payload.toolCallId)
    else if (entry.kind === 'approval_request' && isRecord(payload))
      requests.set((payload as ApprovalRequestPayload).toolCallId, payload as ApprovalRequestPayload)
    else if (entry.kind === 'approval_decision' && isRecord(payload) && typeof payload.requestId === 'string') decided.add(payload.requestId)
  }

  const planned: RunEntry[] = []
  for (const call of calls) {
    if (answered.has(call.id)) continue
    const tool = options.tool(call.name)
    const request = requests.get(call.id)
    if (request && !decided.has(request.requestId) && !executed.has(call.id)) {
      planned.push({ kind: 'approval_decision', runId, payload: { requestId: request.requestId, outcome: 'expired' } })
      planned.push({ kind: 'message', runId, payload: toolResult(call, RECOVERY_TEXT.approvalExpired, true, now) })
      continue
    }
    if (!executed.has(call.id)) {
      const text = tool?.effect === 'read' ? RECOVERY_TEXT.interruptedRead : RECOVERY_TEXT.notRun
      planned.push({ kind: 'message', runId, payload: toolResult(call, text, true, now) })
      continue
    }
    const outcome = await probe(tool, call.arguments, cwd)
    if (outcome === 'applied') planned.push({ kind: 'message', runId, payload: toolResult(call, RECOVERY_TEXT.probedApplied, false, now) })
    else if (outcome === 'not-applied') planned.push({ kind: 'message', runId, payload: toolResult(call, RECOVERY_TEXT.probedNotApplied, true, now) })
    else planned.push({ kind: 'confirmation_request', runId, payload: { toolCallId: call.id } })
  }
  planned.push({ kind: 'run_end', runId, payload: { status: 'interrupted' } })
  return planned
}

// 未回答的结果确认由 entries/ 的 unansweredConfirmations 派生（唯一实现），recovery barrel 原样转出。

/** 用户回答结果确认后补给模型的 toolResult（与 confirmation_answer 一起提交）。 */
export function confirmationResult(input: {
  toolCallId: string
  toolName: string
  answer: ConfirmationAnswerPayload['answer']
  now?: () => number
}): ToolResultMessage {
  const call = { id: input.toolCallId, name: input.toolName }
  const now = input.now ?? Date.now
  if (input.answer === 'applied') return toolResult(call, RECOVERY_TEXT.confirmedApplied, false, now)
  if (input.answer === 'not-applied') return toolResult(call, RECOVERY_TEXT.confirmedNotApplied, true, now)
  return toolResult(call, RECOVERY_TEXT.confirmedUnknown, true, now)
}

/** Run 中某个调用的工具名（来自 assistant 消息）；找不到时 undefined。 */
export function toolNameOf(entries: readonly RecoveryEntry[], toolCallId: string): string | undefined {
  for (const entry of entries) for (const call of toolCallsOf(entry.payload)) if (call.id === toolCallId) return call.name
  return undefined
}
