import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core'
import type { Static, TSchema } from 'typebox'
import type { SandboxPolicy } from '../ports/exec.ts'

/**
 * Tool contract used by Coko: pi's AgentTool plus an optional unified timeout.
 *
 * The contract (name, description, parameters, outputSchema) is what prompts, Session records and
 * replays depend on. Implementations may change; the contract may not.
 */
export interface CokoTool<TParameters extends TSchema = TSchema, TDetails = any> extends AgentTool<TParameters, TDetails> {
  /**
   * Wall-clock limit for one call, in milliseconds. `0` disables the unified timeout (the tool manages
   * its own, like bash's `timeout` argument). Omitted: the runtime default applies.
   */
  timeoutMs?: number
  /**
   * `read`: no side effects; `side-effect`: may change files, processes or external state. Omitted: side-effect.
   * Not part of the contract compared on override, but an override should keep the built-in's value.
   */
  effect?: ToolEffect
  /**
   * What the permission decision looks at: a path for read/grep/find/ls/write/edit, the command for bash.
   * Receives the validated arguments. Omitted: the tool is judged by name only.
   */
  permissionSubject?: (args: Static<TParameters>) => string | undefined
  /**
   * The escalation the call asks for (bash's `sandbox_permissions` and `justification`), read by the permission gate
   * (ADR 0005). Undefined when the call asks for none. Omitted: the tool cannot escalate.
   */
  sandboxRequest?: (args: Static<TParameters>) => { mode?: string; justification?: string } | undefined
  /**
   * Names of the secrets the tool needs (for example `['GITHUB_TOKEN']`). The runtime resolves them through its
   * SecretProvider for each call and passes only these in `context.secrets`; nothing else sees them.
   */
  secrets?: readonly string[]
  /**
   * pi's execute plus the execution context the runtime passes as a fifth argument. Tools that ignore it
   * keep pi's four-argument form.
   */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
    context?: ToolExecutionContext,
  ) => Promise<AgentToolResult<TDetails>>
}

export type ToolEffect = 'read' | 'side-effect'

/** What the runtime tells one call. Absent when a tool is executed outside the runtime (tests, direct calls). */
export interface ToolExecutionContext {
  /**
   * `<sessionId>:<toolCallId>`, the key of the call's `tool_exec` record. Stable across recovery, so an external
   * capability can use it to deduplicate a repeated request.
   */
  idempotencyKey: string
  /**
   * The call's command sandbox, decided at execution from the Session's Permission Mode or a granted escalation. Absent
   * when the runtime has no permission decision (library callers): commands run unconfined.
   */
  sandbox?: SandboxPolicy
  /** The declared secrets of this call, by name. Absent when the tool declares none. Pass them only to the call's own child process. */
  secrets?: Readonly<Record<string, string>>
}

export type { AgentToolResult, AgentToolUpdateCallback }

/** Where the effective implementation of a tool comes from. Logged for diagnostics, never recorded in a Session. */
export type ToolSource = 'builtin' | 'host'

/** Contract fields that an override must keep identical. */
export function toolContract(tool: CokoTool): { name: string; description: string; parameters: unknown; outputSchema: unknown } {
  // JSON round-trip drops TypeBox's symbol-keyed metadata and keeps the JSON Schema the model sees.
  const json = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
  return { name: tool.name, description: tool.description, parameters: json(tool.parameters), outputSchema: json(tool.outputSchema) }
}
