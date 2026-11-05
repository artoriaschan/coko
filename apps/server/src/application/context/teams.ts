// Agent Teams 的上下文贡献（ADR 0018）：send_message 与 task_*（权限类 team，规则组名 Team），根 Session 在有 teammate 或子代理时注册、teammate
// 子 Session 总是注册（一次性子代理没有）；teammate 子 Session 的 <team> section。TeamService 经 SubagentService 取得（装配时接上）。
import { createSendMessageTool, createTaskCreateTool, createTaskListTool, createTaskUpdateTool } from '@coko/agent'
import type { ContextContribution, ContextContributionOptions, RuleTool } from './types.ts'

const TEAM_RULE_TOOLS: readonly RuleTool[] = ['send_message', 'task_create', 'task_update', 'task_list'].map((name) => ({ name, permissionClass: 'team' }))

export function teamsContribution(options: ContextContributionOptions): ContextContribution {
  const subagents = options.subagents
  if (!subagents) return { name: 'teams', ruleTools: TEAM_RULE_TOOLS }
  return {
    name: 'teams',
    ruleTools: TEAM_RULE_TOOLS,
    async systemSections(scope) {
      const teams = subagents.teams()
      const section = teams && scope.parentSessionId && scope.sessionId ? await teams.section(scope.sessionId) : undefined
      return section ? [section] : []
    },
    async stateValues(scope) {
      const teams = subagents.teams()
      if (!teams || !scope.parentSessionId || !scope.sessionId) return {}
      const value = await teams.stateValue(scope.sessionId)
      return value ? { team: value } : {}
    },
    async tools(scope) {
      const teams = subagents.teams()
      if (!teams || scope.sessionId === undefined || !scope.config.teams.enabled) return []
      const teammate = subagents.teammateOf(scope.sessionId)
      if (scope.parentSessionId ? !teammate : !(scope.config.agents.enabled && (await subagents.hasAgents(scope.sessionId)))) return []
      const port = teams.port(scope.sessionId, teammate?.rootId ?? scope.sessionId)
      return [createSendMessageTool(port), createTaskCreateTool(port), createTaskUpdateTool(port), createTaskListTool(port)].map((tool) => ({
        tool,
        permissionClass: 'team' as const,
      }))
    },
  }
}
