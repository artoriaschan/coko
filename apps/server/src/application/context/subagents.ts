// 子代理（ADR 0014）的上下文贡献：agent 工具（权限类 agent，规则组名 Agent），agent_wait（context-read）与 agent_cancel（session-state）只在本
// Session 有子代理时注册；子 Session 的 <subagent> system section、工具交集（filterTools）、max-turns 的请求前检查与 SubagentStop（onStop）；
// 父 Session 中后台子代理的结束通知（pendingInput）与没有送达的通知挂起（onRunEnd）。没有 SubagentService 时只有规则工具名。
import { createAgentCancelTool, createAgentTool, createAgentWaitTool, SUBAGENT_EXCLUDED_TOOLS } from '@coko/agent'
import type { ContextContribution, ContextContributionOptions, RuleTool } from './types.ts'

const AGENT_RULE_TOOLS: readonly RuleTool[] = [
  { name: 'agent', permissionClass: 'agent' },
  { name: 'agent_wait', permissionClass: 'context-read' },
  { name: 'agent_cancel', permissionClass: 'session-state' },
]

const fixedExcluded = (name: string) => SUBAGENT_EXCLUDED_TOOLS.includes(name) || name.startsWith('schedule_')

export function subagentsContribution(options: ContextContributionOptions): ContextContribution {
  const service = options.subagents
  if (!service) return { name: 'subagents', ruleTools: AGENT_RULE_TOOLS }
  return {
    name: 'subagents',
    ruleTools: AGENT_RULE_TOOLS,
    async systemSections(scope) {
      const section = scope.parentSessionId && scope.sessionId ? service.section(scope.sessionId) : undefined
      return section ? [section] : []
    },
    async tools(scope) {
      // 子 Session 没有子代理工具（深度 1）；能力关闭时不注册。
      if (scope.sessionId === undefined || scope.parentSessionId || !scope.config.agents.enabled) return []
      const port = service.port(scope.sessionId)
      const has = await service.hasAgents(scope.sessionId)
      return [
        { tool: createAgentTool(port), permissionClass: 'agent' as const },
        ...(has
          ? [
              { tool: createAgentWaitTool(port), permissionClass: 'context-read' as const },
              { tool: createAgentCancelTool(port), permissionClass: 'session-state' as const },
            ]
          : []),
      ]
    },
    // 子 Session 的工具 = 派发时父级可用工具 ∩ 定义 tools − disallowed-tools − 固定排除集；重启后没有定义时只去掉固定排除集。
    filterTools(tools, scope) {
      if (!scope.parentSessionId) return tools
      const allowed = scope.subagent ? new Set(scope.subagent.tools) : undefined
      return tools.filter((name) => !fixedExcluded(name) && (allowed === undefined || allowed.has(name)))
    },
    async beforeRequest(state, scope) {
      return service.beforeRequest(state, scope)
    },
    async onStop(scope, info) {
      return scope.parentSessionId ? service.subagentStop(scope, info) : undefined
    },
    async pendingInput(scope) {
      return scope.sessionId === undefined || scope.parentSessionId ? undefined : service.pendingInput(scope.sessionId)
    },
    async onRunEnd(_scope, info) {
      await service.runEnded(info)
    },
  }
}
