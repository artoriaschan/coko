// 命令（票 04）：expandInput 识别草稿开头的 /name，提交 command 条目后提交展开文本；命令目录供 GET /api/commands。
// 来源：内置（只列出已接入动作的）、<Workspace>/.coko/commands、COKO_HOME/commands，以及 Skill 与 MCP 提示模板经 commandSources 登记的命令。
import { join } from 'node:path'
import {
  BUILTIN_COMMANDS,
  createCommandRegistry,
  createCommandTemplateLoader,
  parseCommandArgs,
  parseCommandInvocation,
  substituteArgs,
  type BuiltinCommand,
  type CommandDefinition,
  type CommandRegistry,
  type CommandTemplate,
  type ReadOnlyFiles,
  type ResourceDiagnostic,
  type RunInput,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import { PROJECT_COMMANDS_DIR, USER_COMMANDS_DIR, type CommandInfo, type CommandListResponse } from '@coko/protocol'
import type { ContextContribution, ContextContributionOptions, ContextScope, ExpandResult } from './types.ts'

const log = getLogger(['application', 'context', 'commands'])

/**
 * Skill 与 MCP 提示模板向命令目录登记的一条（CommandSourceContribution.list 的元素）。被调用时由来源展开：返回展开后的文本；
 * 参数不合要求时抛出 AppError（例如缺少必填参数时 bad-request），提交以该错误失败。
 */
export interface SourcedCommand extends CommandDefinition {
  source: 'skill' | 'mcp'
  expand(args: string, scope: ContextScope): Promise<string>
}

export function isSourcedCommand(value: unknown): value is SourcedCommand {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.name === 'string' && typeof v.description === 'string' && (v.source === 'skill' || v.source === 'mcp') && typeof v.expand === 'function'
}

type BuiltinEntry = CommandDefinition & { source: 'builtin'; action: string }
type CatalogEntry = BuiltinEntry | CommandTemplate | SourcedCommand

export interface CommandCatalog {
  registry: CommandRegistry<CatalogEntry>
  /** 加载诊断（模板文件与来源）与遮蔽诊断。 */
  diagnostics: ResourceDiagnostic[]
}

export interface CommandsContribution extends ContextContribution {
  name: 'commands'
  /** 该作用域的命令目录（每次重新列目录，文件按 mtime 缓存）。 */
  catalog(scope: ContextScope): Promise<CommandCatalog>
  /** GET /api/commands 的响应。 */
  list(scope: ContextScope): Promise<CommandListResponse>
}

export const isCommandsContribution = (contribution: ContextContribution): contribution is CommandsContribution =>
  contribution.name === 'commands' && typeof (contribution as Partial<CommandsContribution>).catalog === 'function'

export interface CommandsContributionOptions extends ContextContributionOptions {
  /** 其余领域的贡献（取 commandSources 与 actions）；context/index.ts 组合时传入。省略时只有模板。 */
  siblings?: () => readonly ContextContribution[]
  /** 测试注入；缺省 BUILTIN_COMMANDS。 */
  builtins?: readonly BuiltinCommand[]
  files?: ReadOnlyFiles
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const toInfo = (command: CatalogEntry & { enabled: boolean }): CommandInfo => ({
  name: command.name,
  description: command.description,
  ...(command.argumentHint === undefined ? {} : { argumentHint: command.argumentHint }),
  source: command.source,
  ...(command.path === undefined ? {} : { path: command.path }),
  enabled: command.enabled,
})

export function commandsContribution(options: CommandsContributionOptions): CommandsContribution {
  const loader = createCommandTemplateLoader(options.files)
  const builtins = options.builtins ?? BUILTIN_COMMANDS
  const siblings = () => (options.siblings?.() ?? []).filter((c) => c.name !== 'commands')

  async function catalog(scope: ContextScope): Promise<CommandCatalog> {
    const diagnostics: ResourceDiagnostic[] = []
    const others = siblings()
    // 内置命令只在其动作已接入时列出（例如 /compact 随压缩动作一起出现）。
    const actions = new Set(others.flatMap((c) => Object.keys(c.actions ?? {})))
    const entries: CatalogEntry[] = builtins
      .filter((b) => actions.has(b.action))
      .map((b) => ({ name: b.name, description: b.description, argumentHint: b.argumentHint, source: 'builtin', action: b.action }))
    const [project, user] = await Promise.all([
      loader.load(join(scope.cwd, PROJECT_COMMANDS_DIR), 'project'),
      // COKO_HOME 为空时不读（避免把相对路径解析到进程目录）。
      scope.cokoHome === '' ? { templates: [], diagnostics: [] } : loader.load(join(scope.cokoHome, USER_COMMANDS_DIR), 'user'),
    ])
    entries.push(...project.templates, ...user.templates)
    diagnostics.push(...project.diagnostics, ...user.diagnostics)
    for (const contribution of others) {
      for (const source of contribution.commandSources ?? []) {
        try {
          const listed = await source.list(scope)
          for (const item of listed) {
            if (isSourcedCommand(item) && item.source === source.source) entries.push(item)
            else log.warn('command source returned an invalid entry', { contribution: contribution.name, source: source.source })
          }
        } catch (error) {
          log.warn('command source failed', { contribution: contribution.name, source: source.source, error: message(error) })
        }
      }
    }
    const registry = createCommandRegistry(entries, scope.config.commands)
    return { registry, diagnostics: [...diagnostics, ...registry.diagnostics] }
  }

  return {
    name: 'commands',
    catalog,
    async list(scope) {
      const { registry, diagnostics } = await catalog(scope)
      return { commands: registry.commands.map(toInfo), diagnostics }
    },
    async expandInput(input: RunInput, scope: ContextScope): Promise<ExpandResult | undefined> {
      const invocation = parseCommandInvocation(input.text)
      if (!invocation) return undefined
      let command
      try {
        command = (await catalog(scope)).registry.get(invocation.name)
      } catch (error) {
        log.warn('command catalog unavailable', { error: message(error) })
        return undefined
      }
      // 未知或停用的命令：原样作为普通消息。
      if (!command?.enabled) return undefined
      if (command.source === 'builtin') return { kind: 'action', name: command.action, args: invocation.args }
      const text =
        'expand' in command ? await command.expand(invocation.args, scope) : substituteArgs(command.content, parseCommandArgs(invocation.args), invocation.args)
      log.info('command expanded', { name: command.name, source: command.source })
      return {
        kind: 'input',
        input: {
          text,
          before: [...(input.before ?? []), { kind: 'command', payload: { name: command.name, args: invocation.args, source: command.source } }],
        },
      }
    },
  }
}
