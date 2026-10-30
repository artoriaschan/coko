// Plan Mode 的上下文贡献（ADR 0005）：plan 模式的 Run 注入 <plan_mode> 并注册 exit_plan_mode；已批准的计划被压缩摘要掉后注入 <approved_plan>；
// 内置命令 /plan 的动作（/plan [消息] 进入规划，有消息时随后作为普通提交；/plan off 回到进入前的模式）。
// 模式与计划审阅的状态在 SessionPermissions（session-permissions.ts），它创建时经 bindPlanHost 接到本贡献；没有接上时 /plan 以 bad-request 拒绝。
import {
  approvedPlanSection,
  approvedPlanToReinject,
  createExitPlanModeTool,
  EXIT_PLAN_MODE_TOOL,
  planModeSection,
  type PermissionMode,
  type PlanReview,
  type SystemSection,
} from '@coko/agent'
import type { SessionEntry } from '@coko/session'
import { AppError } from '../errors.ts'
import type { ContextContribution, ContextContributionOptions } from './types.ts'

/** 本贡献读写的 Session 权限状态（SessionPermissions 实现）。 */
export interface PlanHost {
  mode(sessionId: string): Promise<PermissionMode>
  /** 切到 plan（记下 prior；已在 plan 时不变）。 */
  enterPlan(sessionId: string): Promise<void>
  /** 回到 prior（不在 plan 时不变）。 */
  exitPlan(sessionId: string): Promise<void>
  review(sessionId: string): PlanReview
  entries(sessionId: string): Promise<readonly SessionEntry[]>
}

const hosts = new WeakMap<ContextContribution, PlanHost>()

/** SessionPermissions 创建时调用：把权限状态接到组合中的 plan 贡献（没有该贡献时什么也不做）。 */
export function bindPlanHost(contributions: readonly ContextContribution[], host: PlanHost): void {
  for (const contribution of contributions) if (contribution.name === 'plan') hosts.set(contribution, host)
}

export function planContribution(_options: ContextContributionOptions): ContextContribution {
  const contribution: ContextContribution = {
    name: 'plan',
    ruleTools: [{ name: EXIT_PLAN_MODE_TOOL, permissionClass: 'plan-exit' }],
    async tools(scope) {
      const host = hosts.get(contribution)
      if (!host || scope.sessionId === undefined || (await host.mode(scope.sessionId)) !== 'plan') return []
      return [{ tool: createExitPlanModeTool(host.review(scope.sessionId)), permissionClass: 'plan-exit' }]
    },
    async systemSections(scope) {
      const host = hosts.get(contribution)
      if (!host || scope.sessionId === undefined) return []
      const sections: SystemSection[] = []
      if ((await host.mode(scope.sessionId)) === 'plan') sections.push(planModeSection())
      const approved = approvedPlanToReinject(await host.entries(scope.sessionId))
      if (approved !== undefined) sections.push(approvedPlanSection(approved))
      return sections
    },
    actions: {
      async plan({ sessionId, args, session }) {
        const host = hosts.get(contribution)
        if (!host) throw new AppError('bad-request', '/plan is not available', { command: 'plan' })
        const text = args.trim()
        if (text.toLowerCase() === 'off') {
          await host.exitPlan(sessionId)
          return { done: true }
        }
        await host.enterPlan(sessionId)
        return text === '' ? { done: true } : session.submit(text)
      },
    },
  }
  return contribution
}
