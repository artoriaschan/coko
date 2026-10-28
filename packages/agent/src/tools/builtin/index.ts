import type { ExecPort } from '../../ports/exec.ts'
import { createToolRegistry, type ToolRegistry } from '../registry.ts'
import type { CokoTool } from '../types.ts'
import { createBashTool } from './bash.ts'
import { createEditTool } from './edit.ts'
import { createFindTool } from './find.ts'
import { createGrepTool } from './grep.ts'
import { createLsTool } from './ls.ts'
import { createReadTool } from './read.ts'
import { createWriteTool } from './write.ts'

export interface BuiltinToolOptions {
  /** Workspace directory; relative tool paths resolve against it. */
  cwd: string
  exec: ExecPort
  /** Directory for bash full-output files; default the OS temp directory. */
  tempDir?: string
}

/** Built-in tools in prompt order: read, write, edit, bash, grep, find, ls. */
export function createBuiltinTools({ cwd, exec, tempDir }: BuiltinToolOptions): CokoTool[] {
  return [
    createReadTool({ cwd }),
    createWriteTool({ cwd }),
    createEditTool({ cwd }),
    createBashTool({ cwd, exec, ...(tempDir ? { tempDir } : {}) }),
    createGrepTool({ cwd }),
    createFindTool({ cwd }),
    createLsTool({ cwd }),
  ]
}

/** A registry pre-filled with the built-in tools; hosts then extend or override. */
export function createBuiltinToolRegistry(options: BuiltinToolOptions): ToolRegistry {
  const registry = createToolRegistry()
  for (const tool of createBuiltinTools(options)) registry.register(tool, { source: 'builtin' })
  return registry
}
