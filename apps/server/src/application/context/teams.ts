// Agent Teams 的上下文贡献：send_message 与 task_*（权限类 team，规则组名 Team）、teammate 的 <team> section。当前只登记规则工具名。
import type { ContextContribution, ContextContributionOptions, RuleTool } from './types.ts'

const TEAM_RULE_TOOLS: readonly RuleTool[] = ['send_message', 'task_create', 'task_update', 'task_list'].map((name) => ({ name, permissionClass: 'team' }))

export function teamsContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'teams', ruleTools: TEAM_RULE_TOOLS }
}
