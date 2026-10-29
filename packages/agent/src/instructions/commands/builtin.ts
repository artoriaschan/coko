// 内置命令列表：只在宿主接入了对应动作时出现在命令目录中（apps/server context/commands.ts）。
import type { BuiltinCommand } from './types.ts'

export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = [
  { name: 'compact', description: 'Summarize earlier messages to free up context', argumentHint: '[instructions]', action: 'compact' },
]
