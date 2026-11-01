// 追踪派生（docs/subsystems/tracing.md）：由已提交的条目得到每个 Run 的模型请求、工具耗时、审批等待与 Hook 结果。纯函数，不新增条目：
// 工具耗时用调用所在 assistant 消息、tool_exec 与结果消息的 createdAt，审批等待用 approval_request 与 approval_decision 的 createdAt。
import type { ModelRequestPayload, ModelRequestUsage } from '../session-entries/observability.ts'

/** 派生读取的条目形状（结构上与 @coko/session 的 SessionEntry 和协议的 SessionEntryRecord 相容）。 */
export interface TraceEntry {
  seq: number
  kind: string
  runId?: string | null
  payload: unknown
  createdAt: number
}

/** 一次有结果的 Hook 执行（hook_run 的摘要；command 与 message 见审计）。 */
export interface HookTrace {
  event: string
  hookId: string
  source: string
  plugin?: string
  outcome: string
  durationMs: number
}

export type ToolApproval = 'pending' | 'allowed' | 'denied' | 'cancelled' | 'expired' | 'superseded'

/** 一次工具调用。durationMs：调用所在 assistant 消息到结果消息（含审批等待与 Hook）；execMs：tool_exec 到结果（只有 side-effect 调用）。 */
export interface ToolTrace {
  toolCallId: string
  name: string
  startedAt: number
  /** 没有结果（Run 被中断）时省略。 */
  durationMs?: number
  execMs?: number
  isError?: boolean
  /** 已回答的审批等待之和；只有等待中的审批时省略。 */
  approvalWaitMs?: number
  /** 最后一次审批的结果；没有审批时省略。 */
  approval?: ToolApproval
  approvalBy?: 'user' | 'hook' | 'headless'
  /** 能归属到这次调用的工具 Hook（PreToolUse、PermissionRequest、PostToolUse、PostToolUseFailure）。 */
  hooks: HookTrace[]
}

export interface RunTrace {
  runId: string
  trigger: string
  /** 没有 run_end（被中断、尚未结束）时省略。 */
  status?: string
  errorCode?: string
  startedAt: number
  durationMs?: number
  requests: ModelRequestPayload[]
  tools: ToolTrace[]
  /** 不属于某一次调用的 Hook：UserPromptSubmit、Stop 等，以及多个调用同时未结束时无法归属的工具 Hook。 */
  hooks: HookTrace[]
  /** 本 Run 全部请求（含压缩与交接的摘要请求）的 usage 之和。 */
  usage: ModelRequestUsage
  /** input + output + cacheRead + cacheWrite（与 Goal 预算的 Token 口径相同）。 */
  tokens: number
  /** 已定价请求的费用之和。 */
  cost: number
}

export interface TraceTotals {
  runs: number
  requests: number
  toolCalls: number
  tokens: number
  cost: number
  /** 已结束 Run 的时长之和。 */
  durationMs: number
}

const TOOL_HOOK_EVENTS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure'])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function hookTrace(payload: Record<string, unknown>): HookTrace {
  return {
    event: String(payload.event),
    hookId: String(payload.hookId),
    source: String(payload.source),
    ...(typeof payload.plugin === 'string' ? { plugin: payload.plugin } : {}),
    outcome: String(payload.outcome),
    durationMs: num(payload.durationMs),
  }
}

interface RunState {
  trace: RunTrace
  /** 已发出、还没有结果的调用。 */
  open: Map<string, ToolTrace>
}

/** 每个 Run 的追踪，按 run_start 的顺序。没有 run_start 的 runId 与不属于 Run 的条目不出现。 */
export function deriveTrace(entries: readonly TraceEntry[]): RunTrace[] {
  const runs = new Map<string, RunState>()
  const tools = new Map<string, ToolTrace>()
  const execAt = new Map<string, number>()
  const approvals = new Map<string, { toolCallId: string; at: number }>()
  for (const entry of entries) {
    const payload = entry.payload
    if (!isRecord(payload)) continue
    if (entry.kind === 'run_start') {
      if (!entry.runId || runs.has(entry.runId)) continue
      runs.set(entry.runId, {
        trace: {
          runId: entry.runId,
          trigger: String(payload.trigger),
          startedAt: entry.createdAt,
          requests: [],
          tools: [],
          hooks: [],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          tokens: 0,
          cost: 0,
        },
        open: new Map(),
      })
      continue
    }
    // 审批的回答可能不带 runId（按 requestId 找到请求）。
    if (entry.kind === 'approval_decision') {
      const asked = approvals.get(String(payload.requestId))
      const tool = asked && tools.get(asked.toolCallId)
      if (!asked || !tool) continue
      tool.approvalWaitMs = (tool.approvalWaitMs ?? 0) + Math.max(0, entry.createdAt - asked.at)
      tool.approval = payload.outcome as ToolApproval
      tool.approvalBy = payload.by === 'hook' || payload.by === 'headless' ? payload.by : 'user'
      continue
    }
    const run = entry.runId ? runs.get(entry.runId) : undefined
    if (!run) continue
    const { trace } = run
    switch (entry.kind) {
      case 'run_end': {
        trace.status = String(payload.status)
        trace.durationMs = Math.max(0, entry.createdAt - trace.startedAt)
        const error = payload.error
        if (isRecord(error) && typeof error.code === 'string') trace.errorCode = error.code
        break
      }
      case 'model_request': {
        const request = payload as unknown as ModelRequestPayload
        trace.requests.push(request)
        const u = request.usage
        trace.usage.input += num(u?.input)
        trace.usage.output += num(u?.output)
        trace.usage.cacheRead += num(u?.cacheRead)
        trace.usage.cacheWrite += num(u?.cacheWrite)
        trace.usage.total += num(u?.total)
        trace.tokens += num(u?.input) + num(u?.output) + num(u?.cacheRead) + num(u?.cacheWrite)
        trace.cost += num(request.cost)
        break
      }
      case 'message': {
        if (payload.role === 'assistant' && Array.isArray(payload.content)) {
          for (const block of payload.content) {
            if (!isRecord(block) || block.type !== 'toolCall' || typeof block.id !== 'string' || tools.has(block.id)) continue
            const tool: ToolTrace = { toolCallId: block.id, name: String(block.name), startedAt: entry.createdAt, hooks: [] }
            tools.set(block.id, tool)
            trace.tools.push(tool)
            run.open.set(block.id, tool)
          }
        } else if (payload.role === 'toolResult' && typeof payload.toolCallId === 'string') {
          const tool = tools.get(payload.toolCallId)
          if (!tool || tool.durationMs !== undefined) break
          tool.durationMs = Math.max(0, entry.createdAt - tool.startedAt)
          const exec = execAt.get(tool.toolCallId)
          if (exec !== undefined) tool.execMs = Math.max(0, entry.createdAt - exec)
          tool.isError = payload.isError === true
          run.open.delete(tool.toolCallId)
        }
        break
      }
      case 'tool_exec':
        if (typeof payload.toolCallId === 'string') execAt.set(payload.toolCallId, entry.createdAt)
        break
      case 'approval_request': {
        const toolCallId = String(payload.toolCallId)
        approvals.set(String(payload.requestId), { toolCallId, at: entry.createdAt })
        const tool = tools.get(toolCallId)
        if (tool) tool.approval = 'pending'
        break
      }
      case 'hook_run': {
        const hook = hookTrace(payload)
        // hook_run 不带 toolCallId：只有一个调用未结束时才能确定它属于哪次调用。
        const [only] = run.open.size === 1 ? run.open.values() : []
        if (TOOL_HOOK_EVENTS.has(hook.event) && only) only.hooks.push(hook)
        else trace.hooks.push(hook)
        break
      }
    }
  }
  return [...runs.values()].map((r) => r.trace)
}

/** Session 合计。 */
export function traceTotals(runs: readonly RunTrace[]): TraceTotals {
  return runs.reduce<TraceTotals>(
    (t, run) => ({
      runs: t.runs + 1,
      requests: t.requests + run.requests.length,
      toolCalls: t.toolCalls + run.tools.length,
      tokens: t.tokens + run.tokens,
      cost: t.cost + run.cost,
      durationMs: t.durationMs + (run.durationMs ?? 0),
    }),
    { runs: 0, requests: 0, toolCalls: 0, tokens: 0, cost: 0, durationMs: 0 },
  )
}
