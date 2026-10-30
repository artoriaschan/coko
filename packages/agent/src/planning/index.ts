// Plan Mode（ADR 0005）：exit_plan_mode 与计划审阅、<plan_mode> 与 <approved_plan> 注入、条目派生。条目 schema 在 session-entries/planning.ts，
// 判定（plan 与 read-only 相同，plan-exit 总询问）在 policy/decide.ts。
export {
  createExitPlanModeTool,
  EXIT_PLAN_MODE_TOOL,
  invalidPlanText,
  PLAN_MAX_CHARS,
  planApprovedText,
  planFeedbackText,
  planMarkdownProblem,
  planReviewOf,
  planTitle,
} from './exit-plan-mode.ts'
export type { PlanReview } from './exit-plan-mode.ts'
export { APPROVED_PLAN_MAX_CHARS, approvedPlanSection, PLAN_MODE_TEXT, planModeSection } from './prompt.ts'
export { approvedPlanToReinject, latestPlan, nextPlanRef } from './state.ts'
export type { PlanRef } from './state.ts'
