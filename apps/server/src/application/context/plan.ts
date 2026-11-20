// Plan Mode 的上下文贡献（ADR 0005、ADR 0028）：开始时计划阶段为规划中的 Run 注入 <plan_mode> 并注册 exit_plan_mode；已批准的计划被压缩摘要掉后注入 <approved_plan>；
// 内置命令 /plan 的动作（/plan [消息] 进入规划，有消息时随后作为普通提交；/plan off 退出规划）：与 POST …/plan 是同一组动作，不改变 Permission Mode。
// 计划阶段与计划审阅的状态在 SessionPermissions（session-permissions.ts），它创建时经 bindPlanHost 接到本贡献；没有接上时 /plan 以 bad-request 拒绝。
import {
  approvedPlanSection,
  approvedPlanToReinject,
  createExitPlanModeTool,
  EXIT_PLAN_MODE_TOOL,
  planModeSection,
  type PlanPhase,
  type PlanReview,
  type SystemSection,
} from '@coko/agent'
import type { SessionEntry } from '@coko/session'
import { AppError } from '../errors.ts'
import type { ContextActionInput, ContextContribution, ContextContributionOptions } from './types.ts'

/** 本贡献读写的 Session 权限状态（SessionPermissions 实现）。 */
export interface PlanHost {
  /** 计划阶段（子 Session 为根 Session 的）。 */
  phase(sessionId: string): Promise<PlanPhase>
  /** 进入（enter）或退出（exit）规划；已在 / 不在规划中时不提交。 */
  planAction(sessionId: string, action: 'enter' | 'exit'): Promise<unknown>
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
      if (!host || scope.sessionId === undefined || (await host.phase(scope.sessionId)) !== 'planning') return []
      return [{ tool: createExitPlanModeTool(host.review(scope.sessionId)), permissionClass: 'plan-exit' }]
    },
    async systemSections(scope) {
      const host = hosts.get(contribution)
      if (!host || scope.sessionId === undefined) return []
      const sections: SystemSection[] = []
      // 子 Session 取根 Session 的阶段，收到只讲不可改动的一段（没有 exit_plan_mode）。
      if ((await host.phase(scope.sessionId)) === 'planning') sections.push(planModeSection(scope.parentSessionId !== undefined))
      const approved = approvedPlanToReinject(await host.entries(scope.sessionId))
      if (approved !== undefined) sections.push(approvedPlanSection(approved))
      return sections
    },
    actions: {
      plan: Object.assign(
        async ({ sessionId, args, session }: ContextActionInput) => {
          const host = hosts.get(contribution)
          if (!host) throw new AppError('bad-request', '/plan is not available', { command: 'plan' })
          const text = args.trim()
          if (text.toLowerCase() === 'off') {
            await host.planAction(sessionId, 'exit')
            return { done: true as const }
          }
          await host.planAction(sessionId, 'enter')
          return text === '' ? { done: true as const } : session.submit(text)
        },
        // 新对话中的 /plan 消息：首次发送以规划开始并提交该消息（没有消息时首次发送拒绝并回滚）。
        { firstSend: true },
      ),
    },
  }
  return contribution
}
