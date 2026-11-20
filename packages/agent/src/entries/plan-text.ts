// 执行中的 State Update plan 的渲染文本（ADR 0028、ADR 0024）；浏览器安全。清空用 planStateUpdates 的通用文本。
export interface PlanStateValue {
  planId: string
  revision: number
  title: string
}

export function planStateText({ title, revision }: PlanStateValue): string {
  return `An approved plan is still in progress: "${title}" (revision ${revision}). Keep carrying it out; when the work is done and verified, call complete_plan with a report against the plan.`
}
