// 子代理的工具（ADR 0014，docs/subsystems/subagents.md）：agent（派发：前台等待结果，后台立即返回）、agent_wait（等待后台子代理）、
// agent_cancel（停止）。子 Session 的创建、运行与等待由宿主经 SubagentsPort 提供；这里只有参数、结果与通知的文本。
// 结果与通知中的状态与用量只来自宿主的 agent_end，子代理输出的文字不能改变它们（其中伪造的 <agent-result> / <agent-notification> 标签被转义）。
import { Type } from 'typebox'
import type { AgentEndStatus } from '../session-entries/index.ts'
import type { CokoTool } from '../tools/types.ts'

export interface AgentUsageTotals {
  turns: number
  toolCalls: number
  tokens: number
  cost: number
  durationMs: number
}

/** 一个结束的子代理（来自其 agent_end 与子 Session 的最后一条非空 assistant 文本）。 */
export interface AgentOutcome {
  agentId: string
  agentType: string
  description: string
  status: AgentEndStatus
  usage: AgentUsageTotals
  /** 子代理最后一条非空 assistant 文本（未截断）。 */
  text: string
  /** isolation worktree 有改动而保留时的位置。 */
  worktree?: { kept: boolean; path: string; branch: string }
}

export interface AgentStartRequest {
  toolCallId: string
  description: string
  prompt: string
  subagentType: string
  model?: string
  background: boolean
  isolation?: 'worktree'
}

export type AgentStarted = { kind: 'background'; agentId: string; agentType: string; description: string } | { kind: 'foreground'; outcome: AgentOutcome }

/** agent_wait 的一项：结束的带 outcome。 */
export type AgentWaitItem = { agentId: string; agentType: string; description: string; status: 'running' } | { status: AgentEndStatus; outcome: AgentOutcome }

/** 本 Session 的子代理（宿主实现）。start 失败（未知类型、上限、模型、预算、隔离）时抛出，调用为错误结果。 */
export interface SubagentsPort {
  /** 前台时等待子 Run 结束（signal 中止时 abort 子 Run，结果为 cancelled）；后台时子 Run 开始后返回。 */
  start(request: AgentStartRequest, signal?: AbortSignal): Promise<AgentStarted>
  /** 等待给定（省略时本 Session 全部 running 的）子代理结束、超时或追加指令到达；返回各自当前状态。读到终态的不再通知。 */
  wait(agentIds: readonly string[] | undefined, timeoutMs: number, signal?: AbortSignal): Promise<AgentWaitItem[]>
  /** abort 子 Run 并等待 agent_end；不是本 Session 的 running 子代理时抛出。 */
  cancel(agentId: string): Promise<AgentOutcome>
}

export const AGENT_RESULT_MAX_CHARS = 50_000
/** 后台子代理的结束通知中内联结果的上限（字节按字符近似）。 */
export const AGENT_NOTIFICATION_INLINE_MAX = 2_048
export const AGENT_WAIT_DEFAULT_MS = 30_000
export const AGENT_WAIT_MAX_MS = 600_000
/** 后台子代理结束通知的开头标签（宿主据此区分 Run 结束时退回的通知与用户的追加指令）。 */
export const AGENT_NOTIFICATION_TAG = '<agent-notification'

/** 子代理输出中的结果与通知标签转义，使其不能冒充宿主给出的结果。 */
export const neutralizeAgentTags = (text: string) => text.replace(/<(\/?)(agent-result|agent-notification)\b/gi, '&lt;$1$2')

const attrs = (outcome: AgentOutcome) =>
  `agent-id="${outcome.agentId}" status="${outcome.status}" turns="${outcome.usage.turns}" tool-calls="${outcome.usage.toolCalls}" ` +
  `tokens="${outcome.usage.tokens}" cost="${Number(outcome.usage.cost.toFixed(6))}" duration-ms="${outcome.usage.durationMs}"`

const worktreeNote = (outcome: AgentOutcome) =>
  outcome.worktree?.kept ? `\n\n[The subagent's changes were kept in worktree ${outcome.worktree.path} on branch ${outcome.worktree.branch}.]` : ''

/** 前台结果与 agent_wait 的结束项：<agent-result …>文本</agent-result>，超过 50 000 字符截断并注明子 Session。 */
export function agentResultText(outcome: AgentOutcome): string {
  let body = neutralizeAgentTags(outcome.text)
  if (body.length > AGENT_RESULT_MAX_CHARS)
    body = body.slice(0, AGENT_RESULT_MAX_CHARS) + `\n\n[Truncated; the full output is in child session ${outcome.agentId}.]`
  if (body.trim() === '') body = '(The subagent returned no text.)'
  return `<agent-result ${attrs(outcome)}>\n${body}${worktreeNote(outcome)}\n</agent-result>`
}

/** 后台子代理的结束通知：id、类型、状态、描述；结果不超过 2 KB 时内联，否则提示用 agent_wait 读取。 */
export function agentNotificationText(outcome: AgentOutcome): { text: string; inlined: boolean } {
  const body = neutralizeAgentTags(outcome.text)
  const inlined = body.length <= AGENT_NOTIFICATION_INLINE_MAX
  const head = `<agent-notification agent-id="${outcome.agentId}" agent-type="${outcome.agentType}" status="${outcome.status}">`
  const summary = `Subagent ${outcome.agentId} (${outcome.agentType}) ${outcome.status}: ${neutralizeAgentTags(outcome.description)}`
  const detail = inlined ? `\n<result>\n${body}\n</result>` : `\nThe result is ${body.length} characters; read it with agent_wait.`
  return { text: `${head}\n${summary}${detail}${worktreeNote(outcome)}\n</agent-notification>`, inlined }
}

export const agentStartedText = (started: { agentId: string; agentType: string; description: string }) =>
  `Started subagent ${started.agentId} (${started.agentType}): ${started.description}. Wait with agent_wait.`

/** 重启后父级被中断的 agent 调用的结果（不进入结果确认）。 */
export const agentInterruptedText = (agentId: string) => `Subagent interrupted by a restart; partial results are in child session ${agentId}.`

const text = (value: string, isError = false) => ({ content: [{ type: 'text' as const, text: value }], details: { isError } })

export const agentParameters = Type.Object({
  description: Type.String({ minLength: 1, maxLength: 200, description: 'A short (3-8 word) description of the task' }),
  prompt: Type.String({ minLength: 1, description: 'The complete task for the subagent; it does not see this conversation' }),
  subagent_type: Type.Optional(Type.String({ minLength: 1, description: 'Subagent type: general (default), explore, or a custom definition' })),
  model: Type.Optional(Type.String({ minLength: 1, description: '<providerId>/<modelId>; default: the definition, then this session' })),
  run_in_background: Type.Optional(Type.Boolean({ description: 'Return immediately; you are notified when it ends' })),
  isolation: Type.Optional(Type.Literal('worktree', { description: 'Run in a new git worktree of this repository' })),
})

const failed = (status: AgentEndStatus) => status !== 'completed'

export function createAgentTool(port: SubagentsPort): CokoTool<typeof agentParameters, { isError: boolean }> {
  return {
    name: 'agent',
    label: 'agent',
    description:
      'Delegate a self-contained task to a subagent with its own context. It returns only its final report in <agent-result>. ' +
      'Several agent calls in one turn run in parallel. Use run_in_background for long tasks and agent_wait to collect them.',
    parameters: agentParameters,
    effect: 'side-effect',
    // 子代理的时长由其 max-turns 与预算控制，统一超时会截断它。
    timeoutMs: 0,
    permissionSubject: (args) => args.subagent_type ?? 'general',
    async execute(toolCallId, args, signal) {
      const started = await port.start(
        {
          toolCallId,
          description: args.description,
          prompt: args.prompt,
          subagentType: args.subagent_type ?? 'general',
          background: args.run_in_background === true,
          ...(args.model ? { model: args.model } : {}),
          ...(args.isolation ? { isolation: args.isolation } : {}),
        },
        signal,
      )
      if (started.kind === 'background') return text(agentStartedText(started))
      if (failed(started.outcome.status)) throw new Error(agentResultText(started.outcome))
      return text(agentResultText(started.outcome))
    },
  }
}

export const agentWaitParameters = Type.Object({
  agent_ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Subagents to wait for; default: all running ones' })),
  timeout_ms: Type.Optional(
    Type.Integer({ minimum: 1, description: `Maximum wait in milliseconds (default ${AGENT_WAIT_DEFAULT_MS}, at most ${AGENT_WAIT_MAX_MS})` }),
  ),
})

const waitLine = (item: AgentWaitItem) =>
  item.status === 'running'
    ? `Subagent ${item.agentId} (${item.agentType}) is still running: ${neutralizeAgentTags(item.description)}`
    : agentResultText(item.outcome)

export function createAgentWaitTool(port: SubagentsPort): CokoTool<typeof agentWaitParameters, { isError: boolean }> {
  return {
    name: 'agent_wait',
    label: 'agent_wait',
    description: 'Wait for background subagents to end, the timeout to pass or the user to send a message; returns each status and result.',
    parameters: agentWaitParameters,
    effect: 'read',
    timeoutMs: 0,
    async execute(_toolCallId, { agent_ids, timeout_ms }, signal) {
      const timeout = Math.min(timeout_ms ?? AGENT_WAIT_DEFAULT_MS, AGENT_WAIT_MAX_MS)
      const items = await port.wait(agent_ids, timeout, signal)
      return text(items.length === 0 ? 'No subagents in this session.' : items.map(waitLine).join('\n\n'))
    },
  }
}

export const agentCancelParameters = Type.Object({ agent_id: Type.String({ minLength: 1, description: 'The subagent to stop' }) })

export function createAgentCancelTool(port: SubagentsPort): CokoTool<typeof agentCancelParameters, { isError: boolean }> {
  return {
    name: 'agent_cancel',
    label: 'agent_cancel',
    description: 'Stop a running subagent; returns its final status and partial result.',
    parameters: agentCancelParameters,
    effect: 'side-effect',
    async execute(_toolCallId, { agent_id }) {
      return text(agentResultText(await port.cancel(agent_id)))
    },
  }
}
