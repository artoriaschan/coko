import { isDeepStrictEqual } from 'node:util'
import type { PermissionClass } from '../policy/decide.ts'
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
  /**
   * Permission class chosen by the host (M3). The tool object cannot declare its own: a `permissionClass` property on the tool is
   * ignored. Omitted: built-in tools keep their class by name, `mcp__*` names are external, other host tools ask.
   */
  permissionClass?: PermissionClass
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
  /** Permission class given at registration (RegisterToolOptions.permissionClass), if any. */
  permissionClass(name: string): PermissionClass | undefined
}

export function createToolRegistry(): ToolRegistry {
  const entries = new Map<string, { tool: CokoTool; source: ToolSource; permissionClass?: PermissionClass }>()
  const entryOf = (tool: CokoTool, options: RegisterToolOptions, source: ToolSource) => ({
    tool,
    source,
    ...(options.permissionClass ? { permissionClass: options.permissionClass } : {}),
  })

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
        entries.set(tool.name, entryOf(tool, options, source))
        return
      }
      if (existing) {
        throw new ToolRegistrationError(tool.name, `Tool "${tool.name}" is already registered; declare override to replace it`)
      }
      entries.set(tool.name, entryOf(tool, options, source))
    },
    get: (name) => entries.get(name)?.tool,
    list: () => [...entries.values()].map((entry) => entry.tool),
    implementations: () => [...entries.entries()].map(([name, entry]) => ({ name, source: entry.source })),
    permissionClass: (name) => entries.get(name)?.permissionClass,
  }
}
