// 内置命令列表：只在宿主接入了对应动作时出现在命令目录中（apps/server context/commands.ts）。
import type { BuiltinCommand } from './types.ts'

export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = [
  { name: 'compact', description: 'Summarize earlier messages to free up context', argumentHint: '[instructions]', action: 'compact' },
  { name: 'plan', description: 'Plan before making changes (read-only until you approve)', argumentHint: '[message | off]', action: 'plan' },
  {
    name: 'goal',
    description: 'Set a goal the agent works toward over several rounds',
    argumentHint: '[objective | pause | resume | cancel | complete]',
    action: 'goal',
  },
  {
    name: 'handoff',
    description: 'Hand off to a new session with a summary as its draft',
    argumentHint: '<next goal>',
    action: 'handoff',
  },
]
