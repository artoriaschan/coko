// 上下文装配的组合（M3 规格"apps/server"）。固定顺序：system section 为 指令 → Skills 索引 → Memory；输入展开为 命令 → File Reference。
// 各领域文件（instructions.ts 等）归所属票；本文件与 types.ts 只由票 01 修改。
import {
  composeAfterToolCall,
  composeBeforeToolCall,
  createToolRegistry,
  type RunInput,
  type SystemSection,
  type ToolHooks,
  type ToolRegistry,
} from '@coko/agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getLogger } from '@coko/logging'
import { ConfigService } from '../config.ts'
import { commandsContribution } from './commands.ts'
import { compactionContribution } from './compaction.ts'
import { instructionsContribution } from './instructions.ts'
import { mcpContribution } from './mcp.ts'
import { memoryContribution } from './memory.ts'
import { referencesContribution } from './references.ts'
import { skillsContribution } from './skills.ts'
import type { ContextAction, ContextContribution, ContextContributionOptions, ContextReport, ContextScope, ContributedTool, ExpandResult } from './types.ts'
import { usageContribution } from './usage.ts'

export type * from './types.ts'

const log = getLogger(['application', 'context'])
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** system section 的顺序：指令 → Skills 索引 → Memory。 */
const SECTION_ORDER = ['instructions', 'skills', 'memory']
/** 输入展开的顺序：命令 → File Reference。 */
const EXPAND_ORDER = ['commands', 'references']

/** 全部领域的贡献（固定顺序；其余钩子按此顺序）。 */
export function createContributions(options: ContextContributionOptions): ContextContribution[] {
  // 命令目录读取其余领域的 commandSources（Skill、MCP 提示模板）与 actions（内置命令）。
  const contributions: ContextContribution[] = [
    instructionsContribution(options),
    commandsContribution({ ...options, siblings: () => contributions }),
    skillsContribution(options),
    referencesContribution(options),
    mcpContribution(options),
    memoryContribution(options),
    usageContribution(options),
    compactionContribution(options),
  ]
  return contributions
}

const ordered = (contributions: readonly ContextContribution[], order: readonly string[]) =>
  order.flatMap((name) => contributions.filter((c) => c.name === name))

/** 组合后的上下文：SessionService 每个 Run 开始时取值并交给运行时。单个领域取值失败只记 warn，不阻止 Run。 */
export interface ContextAssembly {
  scope(input: Omit<ContextScope, 'config' | 'cokoHome'>): Promise<ContextScope>
  systemSections(scope: ContextScope): Promise<SystemSection[]>
  tools(scope: ContextScope): Promise<ContributedTool[]>
  readRoots(scope: ContextScope): Promise<string[]>
  hooks(scope: ContextScope): ToolHooks[]
  expandInput(text: string, scope: ContextScope): Promise<ExpandResult>
  /** 没有领域改动请求时 undefined（运行时不装 transformContext）。 */
  readonly transformMessages: ((messages: AgentMessage[], scope: ContextScope) => AgentMessage[]) | undefined
  action(name: string): ContextAction | undefined
  report(scope: ContextScope): Promise<ContextReport[]>
  readonly contributions: readonly ContextContribution[]
  /** 按顺序关闭各领域（存储关闭之前）；单个失败不影响其余。 */
  close(): Promise<void>
}

export function createContextAssembly(options: {
  contributions: readonly ContextContribution[]
  config: Pick<ConfigService, 'effective'>
  cokoHome: string
}): ContextAssembly {
  const { contributions, config, cokoHome } = options
  const guarded = async <T>(contribution: ContextContribution, what: string, fallback: T, task: () => Promise<T>): Promise<T> => {
    try {
      return await task()
    } catch (error) {
      log.warn('context contribution failed', { contribution: contribution.name, what, error: message(error) })
      return fallback
    }
  }
  const collect = async <T>(what: string, pick: (c: ContextContribution) => (() => Promise<T[]>) | undefined, list = contributions): Promise<T[]> => {
    const out: T[] = []
    for (const c of list) {
      const task = pick(c)
      if (task) out.push(...(await guarded(c, what, [] as T[], task)))
    }
    return out
  }
  const transforms = contributions.flatMap((c) => (c.transformMessages ? [c.transformMessages.bind(c)] : []))
  return {
    contributions,
    async scope(input) {
      return { ...input, config: await config.effective(input.cwd), cokoHome }
    },
    systemSections: (scope) =>
      collect('systemSections', (c) => (c.systemSections ? () => c.systemSections!(scope) : undefined), ordered(contributions, SECTION_ORDER)),
    tools: (scope) => collect('tools', (c) => (c.tools ? () => c.tools!(scope) : undefined)),
    readRoots: (scope) => collect('readRoots', (c) => (c.readRoots ? () => c.readRoots!(scope) : undefined)),
    hooks: (scope) => contributions.flatMap((c) => c.hooks?.(scope) ?? []),
    async expandInput(text, scope) {
      let input: RunInput = { text }
      for (const c of ordered(contributions, EXPAND_ORDER)) {
        if (!c.expandInput) continue
        const result = await c.expandInput(input, scope)
        if (!result) continue
        if (result.kind === 'action') return result
        input = result.input
      }
      return { kind: 'input', input }
    },
    transformMessages:
      transforms.length === 0 ? undefined : (messages, scope) => transforms.reduce((current, transform) => transform(current, scope), messages),
    action(name) {
      for (const c of contributions) if (c.actions && Object.hasOwn(c.actions, name)) return c.actions[name]
      return undefined
    },
    async report(scope) {
      const reports: ContextReport[] = []
      for (const c of contributions) if (c.report) reports.push(await guarded(c, 'report', {}, () => c.report!(scope)))
      return reports
    },
    async close() {
      for (const c of contributions) {
        if (!c.close) continue
        try {
          await c.close()
        } catch (error) {
          log.warn('context contribution close failed', { contribution: c.name, error: message(error) })
        }
      }
    },
  }
}

/** 没有任何贡献的组合（SessionService 未给 context 时）。 */
export const emptyContextAssembly = (cokoHome = ''): ContextAssembly => createContextAssembly({ contributions: [], config: new ConfigService(), cokoHome })

/** 运行时的工具：宿主的基础工具集加上本次 Run 贡献的工具（与基础工具同名的贡献被忽略并记 warn）。 */
export function layeredTools(base: ToolRegistry): { registry: ToolRegistry; set(tools: readonly ContributedTool[]): void } {
  let extra = createToolRegistry()
  return {
    set(tools) {
      const next = createToolRegistry()
      for (const { tool, permissionClass } of tools) {
        if (base.get(tool.name) || next.get(tool.name)) {
          log.warn('contributed tool ignored: name already registered', { tool: tool.name })
          continue
        }
        next.register(tool, permissionClass ? { permissionClass } : {})
      }
      extra = next
    },
    registry: {
      register: (tool, registerOptions) => base.register(tool, registerOptions),
      get: (name) => base.get(name) ?? extra.get(name),
      list: () => [...base.list(), ...extra.list()],
      implementations: () => [...base.implementations(), ...extra.implementations()],
      permissionClass: (name) => (base.get(name) ? base.permissionClass(name) : extra.permissionClass(name)),
    },
  }
}

/** 运行时的 hook：每个 Run 开始时替换为该 Run 贡献的 hook（运行时的 hook 链在创建时固定）。 */
export function dynamicHooks(): { hooks: ToolHooks; set(hooks: readonly ToolHooks[]): void } {
  let before = composeBeforeToolCall([])
  let after = composeAfterToolCall([])
  return {
    set(hooks) {
      before = composeBeforeToolCall(hooks)
      after = composeAfterToolCall(hooks)
    },
    hooks: { beforeToolCall: (context, signal) => before(context, signal), afterToolCall: (context, signal) => after(context, signal) },
  }
}
