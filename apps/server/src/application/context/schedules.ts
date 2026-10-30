// 定时任务（ADR 0015）的上下文贡献：四个工具（schedule_create / schedule_update 为 automation、schedule_list 为 context-read、schedule_delete 为
// session-state；能力开关 schedules.enabled 关闭时不注册），以及 Run 结束后的处理（定时任务 Run 的结束通知、投递挂起的任务）。
// <scheduled_task> 输入由 ScheduleService 开始 Run 时给出（trigger: schedule，不经命令展开）。
import { createScheduleCreateTool, createScheduleDeleteTool, createScheduleListTool, createScheduleUpdateTool } from '@coko/agent'
import type { ContextContribution, ContextContributionOptions, RuleTool } from './types.ts'

const SCHEDULE_RULE_TOOLS: readonly RuleTool[] = [
  { name: 'schedule_create', permissionClass: 'automation' },
  { name: 'schedule_update', permissionClass: 'automation' },
  { name: 'schedule_list', permissionClass: 'context-read' },
  { name: 'schedule_delete', permissionClass: 'session-state' },
]

export function schedulesContribution(options: ContextContributionOptions): ContextContribution {
  const schedules = options.schedules
  if (!schedules) return { name: 'schedules', ruleTools: SCHEDULE_RULE_TOOLS }
  return {
    name: 'schedules',
    ruleTools: SCHEDULE_RULE_TOOLS,
    async tools(scope) {
      if (scope.sessionId === undefined || !scope.config.schedules.enabled) return []
      const port = schedules.port(scope.sessionId)
      return [
        { tool: createScheduleCreateTool(port), permissionClass: 'automation' },
        { tool: createScheduleListTool(port), permissionClass: 'context-read' },
        { tool: createScheduleUpdateTool(port), permissionClass: 'automation' },
        { tool: createScheduleDeleteTool(port), permissionClass: 'session-state' },
      ]
    },
    async onRunEnd(_scope, info) {
      await schedules.runEnded(info)
    },
  }
}
