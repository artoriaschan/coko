// 命令注册表：各来源的命令合成一个目录。同名时按来源顺序取一个，被遮蔽的记诊断 shadowed。
import { diagnostic, type ResourceDiagnostic } from '../shared/diagnostics.ts'
import { COMMAND_SOURCE_ORDER, type CommandDefinition } from './types.ts'

export type RegisteredCommand<T extends CommandDefinition = CommandDefinition> = T & { enabled: boolean }

export interface CommandRegistry<T extends CommandDefinition = CommandDefinition> {
  /** 每个名字一条，按来源顺序、再按名字排序。 */
  readonly commands: RegisteredCommand<T>[]
  readonly diagnostics: ResourceDiagnostic[]
  get(name: string): RegisteredCommand<T> | undefined
}

/** 能力配置的 commands 分区。 */
export interface CommandsConfig {
  enabled: boolean
  disabled: readonly string[]
}

const rank = (definition: CommandDefinition) => COMMAND_SOURCE_ORDER.indexOf(definition.source)
const where = (definition: CommandDefinition) => (definition.path ? `${definition.source} (${definition.path})` : definition.source)

/**
 * commands.enabled 与 commands.disabled 作用于提示模板（项目、用户）与 MCP 提示模板；内置命令总是启用，Skill 的启停由 skills.* 决定
 * （来源经 enabled 给出）。停用的命令仍占用其名字：遮蔽只看来源顺序，与启停无关。
 */
export function createCommandRegistry<T extends CommandDefinition>(definitions: readonly T[], config: CommandsConfig): CommandRegistry<T> {
  const byName = new Map<string, T[]>()
  for (const definition of definitions) {
    const list = byName.get(definition.name)
    if (list) list.push(definition)
    else byName.set(definition.name, [definition])
  }
  const disabled = new Set(config.disabled)
  const enabled = (definition: T) => {
    if (definition.source === 'builtin') return true
    if (definition.source === 'skill') return definition.enabled ?? true
    return config.enabled && !disabled.has(definition.name) && (definition.enabled ?? true)
  }
  const groups = [...byName.values()].map((list) => list.toSorted((a, b) => rank(a) - rank(b)))
  groups.sort((a, b) => rank(a[0]!) - rank(b[0]!) || (a[0]!.name < b[0]!.name ? -1 : a[0]!.name > b[0]!.name ? 1 : 0))
  const commands: RegisteredCommand<T>[] = []
  const diagnostics: ResourceDiagnostic[] = []
  for (const [winner, ...shadowed] of groups) {
    commands.push({ ...winner!, enabled: enabled(winner!) })
    for (const loser of shadowed)
      diagnostics.push(
        diagnostic('commands', 'shadowed', `/${loser.name} from ${where(loser)} is shadowed by /${winner!.name} from ${where(winner!)}`, loser.path),
      )
  }
  const index = new Map(commands.map((command) => [command.name, command]))
  return { commands, diagnostics, get: (name) => index.get(name) }
}
