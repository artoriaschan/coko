// Plan Mode 的上下文贡献（ADR 0005、ADR 0028）：开始时计划阶段为规划中的 Run 注入 <plan_mode> 并注册 exit_plan_mode，规划中或执行中的 Run 注册
// complete_plan（执行中时提交完成报告并结束计划）；执行中的计划被压缩摘要掉后注入
// <approved_plan>，根 Session 执行中时 State Update plan 的值为该计划的标识、修订与标题（否则 null，送达过时清空一次）；
// 内置命令 /plan 的动作（/plan [消息] 进入规划，有消息时随后作为普通提交；/plan off 退出规划）：与 POST …/plan 是同一组动作，不改变 Permission Mode。
// 计划阶段与计划审阅的状态在 SessionPermissions（session-permissions.ts），它创建时经 bindPlanHost 接到本贡献；没有接上时 /plan 以 bad-request 拒绝。
import {
  approvedPlanSection,
  approvedPlanToReinject,
  COMPLETE_PLAN_TOOL,
  createCompletePlanTool,
  createExitPlanModeTool,
  EXIT_PLAN_MODE_TOOL,
  planModeSection,
  planTitle,
  type PlanPhase,
  type PlanReview,
  type SystemSection,
} from '@coko/agent'
import type { SessionPlanResponse } from '@coko/protocol'
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
  /** 计划阶段与活动的 Plan（执行中为被执行的计划）。 */
  sessionPlan(sessionId: string): Promise<SessionPlanResponse>
  /** complete_plan：结束执行中的 Plan；不在执行中时抛出 NO_PLAN_IN_PROGRESS_TEXT。 */
  completePlan(sessionId: string, report: string): Promise<void>
}

const hosts = new WeakMap<ContextContribution, PlanHost>()

/** SessionPermissions 创建时调用：把权限状态接到组合中的 plan 贡献（没有该贡献时什么也不做）。 */
export function bindPlanHost(contributions: readonly ContextContribution[], host: PlanHost): void {
  for (const contribution of contributions) if (contribution.name === 'plan') hosts.set(contribution, host)
}

export function planContribution(_options: ContextContributionOptions): ContextContribution {
  const contribution: ContextContribution = {
    name: 'plan',
    ruleTools: [
      { name: EXIT_PLAN_MODE_TOOL, permissionClass: 'plan-exit' },
      { name: COMPLETE_PLAN_TOOL, permissionClass: 'session-state' },
    ],
    // complete_plan 在规划中也注册：批准发生在 Run 中途，同一 Run 的工具集在开始时取值；子 Session 由固定排除去掉两者。
    async tools(scope) {
      const host = hosts.get(contribution)
      if (!host || scope.sessionId === undefined) return []
      const sessionId = scope.sessionId
      const phase = await host.phase(sessionId)
      if (phase === 'none') return []
      const complete = {
        tool: createCompletePlanTool({ complete: (report) => host.completePlan(sessionId, report) }),
        permissionClass: 'session-state' as const,
      }
      return phase === 'planning' ? [{ tool: createExitPlanModeTool(host.review(sessionId)), permissionClass: 'plan-exit' as const }, complete] : [complete]
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
    // 执行中的提醒（ADR 0024 的既有送达、去重与重发规则）：只对根 Session 给值；批准所在的 Run 不额外送达，下一个带新输入的 Run 开始时送达。
    async stateValues(scope) {
      const host = hosts.get(contribution)
      if (!host || scope.sessionId === undefined || scope.parentSessionId !== undefined) return {}
      const { phase, plan } = await host.sessionPlan(scope.sessionId)
      return { plan: phase === 'executing' && plan ? { planId: plan.planId, revision: plan.revision, title: planTitle(plan.markdown) } : null }
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
