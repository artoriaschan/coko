// 后台任务的上下文贡献（docs/subsystems/jobs.md）：job_output、job_list（context-read）与 job_kill（session-state），Session 空闲时结束的 Job 的
// 完成通知（pendingInput，合并到下一个 Run 的 user message 开头），以及 Run 结束时把没有送达的通知挂起（onRunEnd）。
import { createJobKillTool, createJobListTool, createJobOutputTool } from '@coko/agent'
import type { ContextContribution, ContextContributionOptions, RuleTool } from './types.ts'

const JOB_RULE_TOOLS: readonly RuleTool[] = [
  { name: 'job_output', permissionClass: 'context-read' },
  { name: 'job_list', permissionClass: 'context-read' },
  { name: 'job_kill', permissionClass: 'session-state' },
]

export function jobsContribution(options: ContextContributionOptions): ContextContribution {
  const jobs = options.jobs
  if (!jobs) return { name: 'jobs', ruleTools: JOB_RULE_TOOLS }
  return {
    name: 'jobs',
    ruleTools: JOB_RULE_TOOLS,
    async tools(scope) {
      if (scope.sessionId === undefined) return []
      const port = jobs.port(scope.sessionId)
      return [
        { tool: createJobOutputTool(port), permissionClass: 'context-read' },
        { tool: createJobListTool(port), permissionClass: 'context-read' },
        { tool: createJobKillTool(port), permissionClass: 'session-state' },
      ]
    },
    async pendingInput(scope) {
      return scope.sessionId === undefined ? undefined : jobs.pendingInput(scope.sessionId)
    },
    async onRunEnd(_scope, info) {
      jobs.runEnded(info.sessionId, info.result)
    },
  }
}
