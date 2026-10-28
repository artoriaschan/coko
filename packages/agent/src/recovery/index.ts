// 领域 barrel：启动恢复（planRecovery）与结果确认。packages/agent/src/index.ts 已 re-export 本文件，后续票只改本目录。
export { confirmationResult, planRecovery, RECOVERY_TEXT, toolNameOf, unansweredConfirmations } from './plan.ts'
export type { RecoveryEntry, RecoveryOptions } from './plan.ts'
export type { ToolOutcome } from '../tools/types.ts'
