import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from '@earendil-works/pi-agent-core'
import type { Static, TSchema } from 'typebox'

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
}

export type ToolEffect = 'read' | 'side-effect'

export type { AgentToolResult, AgentToolUpdateCallback }

/** Where the effective implementation of a tool comes from. Logged for diagnostics, never recorded in a Session. */
export type ToolSource = 'builtin' | 'host'

/** Contract fields that an override must keep identical. */
export function toolContract(tool: CokoTool): { name: string; description: string; parameters: unknown; outputSchema: unknown } {
  // JSON round-trip drops TypeBox's symbol-keyed metadata and keeps the JSON Schema the model sees.
  const json = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
  return { name: tool.name, description: tool.description, parameters: json(tool.parameters), outputSchema: json(tool.outputSchema) }
}
