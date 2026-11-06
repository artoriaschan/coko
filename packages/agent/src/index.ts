// Engine
export {
  createAgentRuntime,
  DEFAULT_SYSTEM_PROMPT,
  NoActiveRunError,
  NothingToContinueError,
  NothingToRetryError,
  ONSTOP_CONTINUE_LIMIT,
  PAUSED_BEFORE_APPROVAL_TEXT,
  RuntimeBusyError,
  SUMMARY_EMPTY_TEXT,
  SUMMARY_TOOL_CALL_TEXT,
} from './engine/runtime.ts'
export type { AgentRuntime, AgentRuntimeOptions } from './engine/runtime.ts'
export { DEFAULT_RETRY_POLICY } from './engine/retry.ts'
export type { RetryPolicy } from './engine/retry.ts'
export { BASE_SYSTEM_SECTION } from './engine/runtime.ts'
export { BASE_PROMPT_V2, DEFAULT_SYSTEM_PROMPT_VERSION } from './engine/system-message.ts'
export type {
  BeforeRequestState,
  CompactInfo,
  CompactVerdict,
  RequestStop,
  StopContinue,
  StopInfo,
  ProgressEvent,
  RunEntry,
  RunError,
  RunErrorCode,
  RunInput,
  RunResult,
  RunStatus,
  RuntimeContext,
  RuntimeEvent,
  SystemSection,
} from './engine/types.ts'

// Models
export {
  createModelRegistry,
  MODEL_PROTOCOLS,
  ModelConfigError,
  resolveModel,
  selectableThinkingLevels,
  THINKING_LEVELS,
  withIncrementalTools,
  usesIncrementalTools,
} from './models/registry.ts'
export type {
  ModelPrice,
  ModelProtocol,
  ModelRegistry,
  ModelRegistryOptions,
  ModelSpec,
  ProviderConfig,
  ThinkingLevel,
  ThinkingLevelSpec,
} from './models/registry.ts'
export { ListModelsError, listProviderModels } from './models/list-models.ts'
export { isHttpUrl } from './models/base-url.ts'
export type { ListModelsErrorCode, ListProviderModelsOptions } from './models/list-models.ts'

// Tools
export { createToolRegistry, ToolRegistrationError } from './tools/registry.ts'
export type { RegisterToolOptions, ToolImplementation, ToolRegistry } from './tools/registry.ts'
export { toolContract } from './tools/types.ts'
export type { CokoTool, CokoToolResult, ToolEffect, ToolExecutionContext, ToolSource } from './tools/types.ts'
export { DEFAULT_TOOL_CONCURRENCY } from './tools/scheduler.ts'
export { DEFAULT_ABORT_GRACE_MS, DEFAULT_TOOL_TIMEOUT_MS, withTimeout } from './tools/timeout.ts'
export type { TimeoutOptions } from './tools/timeout.ts'
export { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, GREP_MAX_LINE_LENGTH } from './tools/truncate.ts'
export { createBuiltinToolRegistry, createBuiltinTools } from './tools/builtin/index.ts'
export type { BuiltinToolOptions } from './tools/builtin/index.ts'
export { createGrepTool, GREP_DEFAULT_LIMIT, grepParameters, jsGrepSearcher } from './tools/builtin/grep.ts'
export type { GrepMatch, GrepSearcher, GrepSearchRequest, GrepSearchResult, GrepToolDetails } from './tools/builtin/grep.ts'
export { bashOutputSchema } from './tools/builtin/bash.ts'
export type { BashOutput, BashToolDetails } from './tools/builtin/bash.ts'
export type { EditToolDetails } from './tools/builtin/edit.ts'

// Session Entry payloads（按领域分文件）与领域 barrel。
export * from './session-entries/index.ts'
export * from './policy/index.ts'
export { MCP_TOOL_PREFIX } from './policy/decide.ts'
export type { PermissionClass } from './policy/decide.ts'
export * from './recovery/index.ts'
export * from './checkpoints/index.ts'
// 条目派生的唯一实现；renderer 经浏览器安全子路径 @coko/agent/entries 导入同一模块。
export * from './entries/index.ts'
export * from './agents/index.ts'

// M3 扩展点：指令类资源、上下文管理、能力配置与 MCP（各子目录有自己的 barrel）。
export * from './instructions/index.ts'
export * from './context/index.ts'
export * from './config/index.ts'
export * from './extensions/mcp/index.ts'
// M6 领域（类型与 seam；各领域的实现在其目录中补全）：插件、语言服务器、Agent Teams、观测。
export * from './extensions/plugins/index.ts'
export * from './tools/lsp/index.ts'
export * from './agents/teams/index.ts'
export * from './observability/index.ts'

// M4：目标与任务（各子目录有自己的 barrel）。
export * from './goals/index.ts'
export * from './planning/index.ts'
export * from './tasks/index.ts'

// Hooks：工具调用的 hook 链与外部 Hook 的类型（extensions/hooks/）。
export {
  aggregateVerdict,
  blockedByHookText,
  combinePreToolUse,
  composeAfterToolCall,
  composeBeforeToolCall,
  HOOK_EVENTS,
  hookDigest,
  hookTimeoutMs,
  interpretHookResult,
  MATCHERLESS_HOOK_EVENTS,
  matcherMatches,
  parseHooksConfig,
  selectHooks,
  TOOL_HOOK_EVENTS,
  validMatcher,
} from './extensions/hooks/index.ts'
export type {
  CombinedDecision,
  HookCondition,
  HookDecision,
  HookEventContext,
  HookProcessResult,
  HookResult,
  HookTarget,
  HookToolCall,
  HookVerdict,
  HostBlock,
  LoadedHook,
  ParsedHooks,
  SourcedHookResult,
  ToolBlockResult,
  ToolHooks,
} from './extensions/hooks/index.ts'

// Ports
export type { ExecOutcome, ExecPort, ExecRequest } from './ports/exec.ts'
export type { RewindFiles, SnapshotPort } from './ports/checkpoints.ts'
export { PtyUnavailableError } from './ports/pty.ts'
export type { PtyExit, PtyPort, PtyProcess, PtySpawnRequest } from './ports/pty.ts'
export { createLocalExecPort, DEFAULT_COMMAND_SHELL, filterEnv } from './ports/local-exec.ts'
export type { EnvExclusion, LocalExecOptions } from './ports/local-exec.ts'
export { InMemoryCredentialStore } from './ports/credentials.ts'
export type { ApiKeyCredential, Credential, CredentialInfo, CredentialStore } from './ports/credentials.ts'

export { MAX_IMAGE_BYTES, detectImageMimeType } from './tools/builtin/read.ts'

export { captureRequestSnapshot, modelRequestPayload } from './engine/model-requests.ts'
export * from './tools/tool-search/index.ts'
