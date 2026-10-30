// 子代理（ADR 0014）的上下文贡献（M5）。当前为空贡献：只占住组合中的位置，由子代理的实现实现（system section、工具、hook 与 seam）。
import type { ContextContribution, ContextContributionOptions } from './types.ts'

export function subagentsContribution(_options: ContextContributionOptions): ContextContribution {
  return { name: 'subagents' }
}
