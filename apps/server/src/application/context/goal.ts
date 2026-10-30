// Goal 的上下文贡献（docs/subsystems/goal.md）：<goal> system section（Goal 未终结时每个 Run 注入，压缩后同样存在）、Goal 工具（get_goal 为
// context-read，create_goal、update_goal 为 session-state）、预算检查点（工具调用前的 hook 与模型请求前的 beforeRequest）、Run 结束后的阶段
// 转换与推进（GoalService.runEnded），以及内置命令 /goal 的动作。
import { createCreateGoalTool, createGetGoalTool, createUpdateGoalTool } from '@coko/agent'
import { AppError } from '../errors.ts'
import type { ContextAction, ContextContribution, ContextContributionOptions, RuleTool } from './types.ts'

const GOAL_RULE_TOOLS: readonly RuleTool[] = [
  { name: 'get_goal', permissionClass: 'context-read' },
  { name: 'create_goal', permissionClass: 'session-state' },
  { name: 'update_goal', permissionClass: 'session-state' },
]

/** 独占整段参数时识别的控制词（不产生 user message）。 */
const CONTROLS = ['pause', 'resume', 'cancel', 'complete'] as const
type Control = (typeof CONTROLS)[number]
const control = (args: string): Control | undefined => CONTROLS.find((c) => c === args.trim().toLowerCase())

/** /goal <目标> 展开的提交文本：请模型调用 create_goal 并记下成功条件。 */
export function goalRequestText(objective: string): string {
  return (
    'Create a goal for this objective with create_goal, recording 1 to 10 concrete, checkable success criteria, then start working on it.\n\n' +
    'Objective: ' +
    objective
  )
}

export function goalContribution(options: ContextContributionOptions): ContextContribution {
  const goals = options.goals
  const action: ContextAction = Object.assign(
    async ({ sessionId, args, session }: Parameters<ContextAction>[0]) => {
      if (!goals) throw new AppError('bad-request', '/goal is not available', { command: 'goal' })
      const text = args.trim()
      // 无参数：界面打开 Goal 卡，不产生条目。
      if (text === '') return { done: true as const }
      const word = control(text)
      if (!word) return session.submit(goalRequestText(text))
      await goals.act(sessionId, { action: word, revision: await goals.revision(sessionId) })
      return { done: true as const }
    },
    // /goal pause 与 /goal cancel 在 Run 进行中也可用（控制词独占整段输入时）。
    { whileRunning: (args: string) => ['pause', 'cancel'].includes(args.trim().toLowerCase()) },
  )
  if (!goals) return { name: 'goal', ruleTools: GOAL_RULE_TOOLS, actions: { goal: action } }
  return {
    name: 'goal',
    ruleTools: GOAL_RULE_TOOLS,
    async systemSections(scope) {
      if (scope.sessionId === undefined) return []
      const section = await goals.systemSection(scope.sessionId)
      return section ? [section] : []
    },
    async tools(scope) {
      if (scope.sessionId === undefined) return []
      const names = await goals.toolNames(scope.sessionId)
      const port = goals.port(scope.sessionId)
      return [
        ...(names.read ? [{ tool: createGetGoalTool(port), permissionClass: 'context-read' as const }] : []),
        ...(names.create ? [{ tool: createCreateGoalTool(port), permissionClass: 'session-state' as const }] : []),
        ...(names.update ? [{ tool: createUpdateGoalTool(port), permissionClass: 'session-state' as const }] : []),
      ]
    },
    // 预算检查点：工具调用前（权限判定之后）检查调用数；每次模型请求前检查 Token、费用、时间与未定价。
    hooks(scope) {
      return scope.sessionId === undefined ? [] : [goals.toolHooks(scope.sessionId)]
    },
    async beforeRequest(state, scope) {
      if (scope.sessionId === undefined) return undefined
      const stop = await goals.beforeRequest(scope.sessionId, state.runId)
      return stop ? { stop } : undefined
    },
    async onRunEnd(_scope, info) {
      await goals.runEnded(info)
    },
    actions: { goal: action },
  }
}
