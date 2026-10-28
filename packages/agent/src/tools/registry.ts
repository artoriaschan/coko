import { isDeepStrictEqual } from 'node:util'
import { toolContract, type CokoTool, type ToolSource } from './types.ts'

export class ToolRegistrationError extends Error {
  override readonly name = 'ToolRegistrationError'
  readonly toolName: string
  constructor(toolName: string, message: string) {
    super(message)
    this.toolName = toolName
  }
}

export interface RegisterToolOptions {
  /** Replace an already registered tool with the same name. The contract must stay identical. */
  override?: boolean
  /** Defaults to `host`. Built-in registration passes `builtin`. */
  source?: ToolSource
}

export interface ToolImplementation {
  name: string
  source: ToolSource
}

export interface ToolRegistry {
  /**
   * Register a tool. A new name extends the tool set. An existing name throws unless
   * `override: true` is declared and the contract (name, description, parameters, outputSchema) is unchanged.
   */
  register(tool: CokoTool, options?: RegisterToolOptions): void
  get(name: string): CokoTool | undefined
  /** Effective tools in registration order. */
  list(): CokoTool[]
  /** Effective implementation per tool, for logs. */
  implementations(): ToolImplementation[]
}

export function createToolRegistry(): ToolRegistry {
  const entries = new Map<string, { tool: CokoTool; source: ToolSource }>()

  return {
    register(tool, options = {}) {
      const source = options.source ?? 'host'
      const existing = entries.get(tool.name)
      if (options.override) {
        if (!existing) {
          throw new ToolRegistrationError(tool.name, `Tool "${tool.name}" declares override, but there is nothing to override`)
        }
        if (!isDeepStrictEqual(toolContract(existing.tool), toolContract(tool))) {
          throw new ToolRegistrationError(
            tool.name,
            `Override of tool "${tool.name}" changes its contract (description, parameters or outputSchema); register it under a new name`,
          )
        }
        entries.set(tool.name, { tool, source })
        return
      }
      if (existing) {
        throw new ToolRegistrationError(tool.name, `Tool "${tool.name}" is already registered; declare override to replace it`)
      }
      entries.set(tool.name, { tool, source })
    },
    get: (name) => entries.get(name)?.tool,
    list: () => [...entries.values()].map((entry) => entry.tool),
    implementations: () => [...entries.entries()].map(([name, entry]) => ({ name, source: entry.source })),
  }
}
