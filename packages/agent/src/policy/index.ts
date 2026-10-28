// 领域 barrel：权限判定与 ApprovalBroker（票 02、03、05 在此导出）。packages/agent/src/index.ts 已 re-export 本文件，后续票只改本目录。
export { canonicalRuleTool, decide, isProtectedPath, isWithin, PROTECTED_PATH_NAMES, readDenial, ruleToolName, toolCategory } from './decide.ts'
export type { AskReason, PermissionCall, PermissionContext, PermissionDecision, PermissionTarget, ToolCategory } from './decide.ts'
export { ApprovalNotPendingError, createApprovalBroker } from './broker.ts'
export type { ApprovalAnswer, ApprovalBroker, ApprovalResolution, ReevaluateVerdict } from './broker.ts'
export { REJECTED_TEXT } from './gate.ts'
export { analyzeCommand, commandMatches, MAX_SUBCOMMANDS, pathMatches, stripEnvPrefix } from './rules.ts'
export type { CommandAnalysis, Subcommand } from './rules.ts'
export { realLocation, resolveTarget, writableRootsFor } from './paths.ts'
export type { ToolEffect } from '../tools/types.ts'
// 票 05：命令沙箱、单次提权与 Secrets 端口（ports 的新导出也经本 barrel，packages/agent/src/index.ts 归票 01）。
export {
  checkEscalation,
  escalationHintMarker,
  escalationRejectedText,
  isWiderSandbox,
  sandboxDenialMarker,
  sandboxModeFor,
  sandboxPolicyFor,
  sandboxUnavailableText,
  writableRootsForSandbox,
} from './sandbox.ts'
export type { EscalationArgs, EscalationCheck } from './sandbox.ts'
export { isConfined, SandboxUnavailableError } from '../ports/exec.ts'
export type { SandboxPolicy } from '../ports/exec.ts'
export type { LocalSandbox } from '../ports/local-exec.ts'
export { MissingSecretError, resolveSecrets } from '../ports/secrets.ts'
export type { SecretProvider } from '../ports/secrets.ts'
