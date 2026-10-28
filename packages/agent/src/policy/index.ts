// 领域 barrel：权限判定与 ApprovalBroker（票 02、03、05 在此导出）。packages/agent/src/index.ts 已 re-export 本文件，后续票只改本目录。
export { decide, isProtectedPath, isWithin, ruleToolName, toolCategory } from './decide.ts'
export type { AskReason, PermissionCall, PermissionContext, PermissionDecision, PermissionTarget, ToolCategory } from './decide.ts'
export { ApprovalNotPendingError, createApprovalBroker } from './broker.ts'
export type { ApprovalAnswer, ApprovalBroker, ApprovalResolution } from './broker.ts'
export { REJECTED_TEXT } from './gate.ts'
export { realLocation, resolveTarget, writableRootsFor } from './paths.ts'
export type { ToolEffect } from '../tools/types.ts'
