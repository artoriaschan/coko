// 领域 barrel：权限判定、ApprovalBroker、命令沙箱与提权（ADR 0005）。
export {
  canonicalRuleTool,
  contextReadDenial,
  decide,
  isProtectedPath,
  pathContains,
  PROTECTED_PATH_NAMES,
  readDenial,
  ruleToolName,
  toolCategory,
} from './decide.ts'
export type { AskReason, PermissionCall, PermissionContext, PermissionDecision, PermissionTarget, ToolCategory } from './decide.ts'
export { ApprovalNotPendingError, createApprovalBroker } from './broker.ts'
export type { ApprovalAnswer, ApprovalBroker, ApprovalResolution, ReevaluateVerdict } from './broker.ts'
export { REJECTED_TEXT } from './gate.ts'
export { analyzeCommand, commandMatches, MAX_SUBCOMMANDS, pathMatches, stripEnvPrefix } from './rules.ts'
export type { CommandAnalysis, Subcommand } from './rules.ts'
export { realLocation, resolveTarget, writableRootsFor } from './paths.ts'
export type { ToolEffect } from '../tools/types.ts'
// 命令沙箱、单次提权与 Secrets 端口。
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
