// 领域 barrel：多代理与会话派生（agent-runtime.md 的 agents/）：从此分叉、交接、子代理的定义与工具（ADR 0014）。
export { forkEntries } from './fork.ts'
export { HANDOFF_COPIED_KINDS, HANDOFF_SUMMARY_MAX_CHARS, handoffPrompt, handoffSummaryText, handoffTargetEntries, hasUserMessage } from './handoff.ts'
export {
  AGENT_DEFAULT_MAX_TURNS,
  AGENT_MAX_TURNS_LIMIT,
  BUILTIN_AGENTS,
  createAgentDefinitionLoader,
  effectiveSubagentMode,
  isSubagentExcludedTool,
  narrowerMode,
  parseAgentDefinition,
  PERMISSION_MODE_ORDER,
  SUBAGENT_EXCLUDED_TOOLS,
  subagentTools,
} from './definitions.ts'
export type { AgentCatalog, AgentDefinition, AgentDefinitionLoader, AgentDefinitionsInput, ParseAgentOptions } from './definitions.ts'
export {
  AGENT_NOTIFICATION_INLINE_MAX,
  AGENT_RESULT_MAX_CHARS,
  AGENT_WAIT_DEFAULT_MS,
  AGENT_WAIT_MAX_MS,
  AGENT_NOT_STARTED_TEXT,
  agentInterruptedText,
  agentNotificationText,
  agentResultText,
  agentStartedText,
  createAgentCancelTool,
  createAgentTool,
  createAgentWaitTool,
  neutralizeAgentTags,
} from './tools.ts'
export type { AgentOutcome, AgentStarted, AgentStartRequest, AgentUsageTotals, AgentWaitItem, SubagentsPort } from './tools.ts'
