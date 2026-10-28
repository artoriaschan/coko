// 领域 barrel：启动恢复（planRecovery）与结果确认（recovery.md）。
export { confirmationResult, planRecovery, RECOVERY_TEXT, toolNameOf, unansweredConfirmations } from './plan.ts'
export type { RecoveryEntry, RecoveryOptions } from './plan.ts'
export type { ToolOutcome } from '../tools/types.ts'
