import { loadedToolNames, planStateUpdates, type StateUpdateDelivery, type StateValues, type EntryLike } from '@coko/agent/entries'
import { redactSecretsDeep } from '@coko/logging'
// 上下文装配的组合（docs/subsystems/context.md）。固定顺序：system section 为 环境 → 指令 → Skills 索引 → Memory → plan → goal；
// 输入展开为 命令 → File Reference。
import {
  createToolSearch,
  renderOnDemandCatalog,
  type OnDemandTool,
  composeAfterToolCall,
  composeBeforeToolCall,
  createToolRegistry,
  emptyPluginContributions,
  type PluginContributionsPort,
  type BeforeRequestState,
  type CompactInfo,
  type CompactVerdict,
  type PermissionHookPort,
  type RunInput,
  type StopContinue,
  type StopInfo,
  type SystemSection,
  type ToolHooks,
  type ToolRegistry,
  type CokoTool,
} from '@coko/agent'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getLogger } from '@coko/logging'
import { ConfigService } from '../config.ts'
import { commandsContribution } from './commands.ts'
import { compactionContribution } from './compaction.ts'
import { dateContribution } from './date.ts'
import { environmentContribution } from './environment.ts'
import { goalContribution } from './goal.ts'
import { handoffContribution } from './handoff.ts'
import { hooksContribution } from './hooks.ts'
import { instructionsContribution } from './instructions.ts'
import { jobsContribution } from './jobs.ts'
import { lspContribution } from './lsp.ts'
import { mcpContribution } from './mcp.ts'
import { memoryContribution } from './memory.ts'
import { planContribution } from './plan.ts'
import { referencesContribution } from './references.ts'
import { schedulesContribution } from './schedules.ts'
import { skillsContribution } from './skills.ts'
import { subagentsContribution } from './subagents.ts'
import { teamsContribution } from './teams.ts'
import { todoContribution } from './todo.ts'
import type {
  ContextAction,
  ContextContribution,
  ContextContributionOptions,
  ContextReport,
  ContextScope,
  ContributedTool,
  ExpandResult,
  PendingInput,
  RequestVerdict,
  RuleTool,
  RunEndInfo,
  SubmitVerdict,
} from './types.ts'
import { usageContribution } from './usage.ts'

export type * from './types.ts'

const log = getLogger(['application', 'context'])
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** system section 的顺序：环境 → 指令 → Skills 索引 → Memory → plan → goal → 子代理（子 Session 的 <subagent>）→ 团队（teammate 的 <team>）。 */
const SECTION_ORDER = ['environment', 'instructions', 'skills', 'memory', 'plan', 'goal', 'subagents', 'teams']
/** 输入展开的顺序：命令 → File Reference。 */
const EXPAND_ORDER = ['commands', 'references']

/** 全部领域的贡献（固定顺序；其余钩子按此顺序）。 */
export function createContributions(options: ContextContributionOptions): ContextContribution[] {
  // 命令目录读取其余领域的 commandSources（Skill、MCP 提示模板）与 actions（内置命令）。
  const contributions: ContextContribution[] = [
    environmentContribution(),
    dateContribution(options.clock),
    instructionsContribution(options),
    commandsContribution({ ...options, siblings: () => contributions }),
    skillsContribution(options),
    referencesContribution(options),
    mcpContribution(options),
    memoryContribution(options),
    usageContribution(options),
    compactionContribution(options),
    planContribution(options),
    goalContribution(options),
    todoContribution(options),
    jobsContribution(options),
    hooksContribution(options),
    subagentsContribution(options),
    schedulesContribution(options),
    handoffContribution(options),
    lspContribution(options),
    teamsContribution(options),
    ...(options.extra ?? []),
  ]
  return contributions
}

const ordered = (contributions: readonly ContextContribution[], order: readonly string[]) =>
  order.flatMap((name) => contributions.filter((c) => c.name === name))

/** 组合后的上下文：SessionService 每个 Run 开始时取值并交给运行时。单个领域取值失败只记 warn，不阻止 Run。 */
export interface ContextAssembly {
  /** 取值：有效配置与已启用插件的贡献快照（plugins.enabled 为 false 时为空）。 */
  scope(input: Omit<ContextScope, 'config' | 'cokoHome' | 'plugins'>): Promise<ContextScope>
  systemSections(scope: ContextScope): Promise<SystemSection[]>
  stateUpdates(scope: ContextScope, entries: () => Promise<readonly EntryLike[]>, catalog?: readonly OnDemandTool[]): Promise<StateUpdateDelivery | undefined>
  tools(scope: ContextScope): Promise<ContributedTool[]>
  readRoots(scope: ContextScope): Promise<string[]>
  hooks(scope: ContextScope): ToolHooks[]
  /** 各领域的准入 hook（ContextContribution.admissionHooks），排在扩展与 hooks 之前。 */
  admissionHooks(scope: ContextScope): ToolHooks[]
  expandInput(text: string, scope: ContextScope): Promise<ExpandResult>
  /** 没有领域改动请求时 undefined（运行时不装 transformContext）。 */
  readonly transformMessages: ((messages: AgentMessage[], scope: ContextScope) => AgentMessage[]) | undefined
  action(name: string): ContextAction | undefined
  report(scope: ContextScope): Promise<ContextReport[]>
  /** 每次模型请求前按领域顺序检查，第一个 stop 为准；没有领域检查时 undefined。单个领域失败只记 warn（放行）。 */
  readonly beforeRequest: ((state: BeforeRequestState, scope: ContextScope) => Promise<RequestVerdict>) | undefined
  /** 各领域的待送达内容按领域顺序合并；没有时 undefined。 */
  pendingInput(scope: ContextScope): Promise<PendingInput | undefined>
  /** Run 结束后按领域顺序通知；单个失败只记 warn。 */
  onRunEnd(scope: ContextScope, info: RunEndInfo): Promise<void>
  /** 各领域声明的规则工具（ContextContribution.ruleTools 的汇总）。 */
  readonly ruleTools: readonly RuleTool[]
  /** M5：外部 Hook 的权限端口（第一个给出的领域为准）；没有时 undefined，gate 与没有 Hook 时相同。 */
  permissionHooks(scope: ContextScope): PermissionHookPort | undefined
  /** 观察 hook（排在登记明文替换之后）。 */
  observeHooks(scope: ContextScope): ToolHooks[]
  /** 提交前检查：第一个 reject 为准；各领域的 context 按领域顺序以空行连接。单个领域失败只记 warn（放行）。 */
  beforeSubmit(scope: ContextScope, text: string): Promise<SubmitVerdict>
  /** 压缩前：第一个 block 为准，instructions 以空行连接；没有领域检查时 undefined（运行时不装）。 */
  readonly beforeCompact: ((scope: ContextScope, info: CompactInfo) => Promise<void | CompactVerdict>) | undefined
  /** Run 正常结束前：第一个 continue 为准；没有领域时 undefined（运行时不装）。 */
  readonly onStop: ((scope: ContextScope, info: StopInfo) => Promise<void | StopContinue>) | undefined
  /** 工具名过滤（各领域依次）；没有领域过滤时原样返回。 */
  filterTools(tools: readonly string[], scope: ContextScope): readonly string[]
  readonly contributions: readonly ContextContribution[]
  /** 按顺序关闭各领域（存储关闭之前）；单个失败不影响其余。 */
  close(): Promise<void>
}

export function createContextAssembly(options: {
  contributions: readonly ContextContribution[]
  config: Pick<ConfigService, 'effective'>
  cokoHome: string
  /** 插件消费 seam（ADR 0017）；省略时没有插件。 */
  plugins?: Pick<PluginContributionsPort, 'snapshot'>
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
  const checks = contributions.filter((c) => c.beforeRequest)
  const compactChecks = contributions.filter((c) => c.beforeCompact)
  const stops = contributions.filter((c) => c.onStop)
  return {
    contributions,
    ruleTools: contributions.flatMap((c) => c.ruleTools ?? []),
    permissionHooks(scope) {
      for (const c of contributions) {
        const port = c.permissionHooks?.(scope)
        if (port) return port
      }
      return undefined
    },
    observeHooks: (scope) => contributions.flatMap((c) => c.observeHooks?.(scope) ?? []),
    async beforeSubmit(scope, text) {
      const context: string[] = []
      for (const c of contributions) {
        if (!c.beforeSubmit) continue
        const verdict = await guarded(c, 'beforeSubmit', undefined as SubmitVerdict, () => c.beforeSubmit!(scope, text))
        if (!verdict) continue
        if ('reject' in verdict) return verdict
        if (verdict.context !== '') context.push(verdict.context)
      }
      return context.length > 0 ? { context: context.join('\n\n') } : undefined
    },
    beforeCompact:
      compactChecks.length === 0
        ? undefined
        : async (scope, info) => {
            const instructions: string[] = []
            for (const c of compactChecks) {
              const verdict = await guarded(c, 'beforeCompact', undefined as void | CompactVerdict, () => c.beforeCompact!(scope, info))
              if (!verdict) continue
              if ('block' in verdict) return verdict
              if (verdict.instructions !== '') instructions.push(verdict.instructions)
            }
            return instructions.length > 0 ? { instructions: instructions.join('\n\n') } : undefined
          },
    onStop:
      stops.length === 0
        ? undefined
        : async (scope, info) => {
            for (const c of stops) {
              const verdict = await guarded(c, 'onStop', undefined as void | StopContinue, () => c.onStop!(scope, info))
              if (verdict) return verdict
            }
            return undefined
          },
    filterTools: (tools, scope) => contributions.reduce((current, c) => (c.filterTools ? c.filterTools(current, scope) : current), tools),
    async scope(input) {
      const effective = await config.effective(input.cwd)
      const plugins = effective.plugins.enabled && options.plugins ? await options.plugins.snapshot() : emptyPluginContributions()
      return { ...input, config: effective, cokoHome, plugins }
    },
    systemSections: (scope) =>
      collect('systemSections', (c) => (c.systemSections ? () => c.systemSections!(scope) : undefined), ordered(contributions, SECTION_ORDER)),
    async stateUpdates(scope, entries, catalog) {
      try {
        const values: StateValues = {}
        for (const contribution of contributions) {
          if (contribution.stateValues) Object.assign(values, await contribution.stateValues(scope))
        }
        if (catalog?.length) values.on_demand_tools = catalog.map((tool) => tool.name).sort()
        return planStateUpdates(
          redactSecretsDeep(values),
          await entries(),
          catalog?.length
            ? {
                on_demand_tools: (_value, previous) =>
                  renderOnDemandCatalog(redactSecretsDeep(catalog), {
                    contextWindow: scope.model?.contextWindow,
                    ...(Array.isArray(previous) ? { previousNames: previous } : {}),
                  }),
              }
            : {},
        )
      } catch (error) {
        log.warn('state updates unavailable', { error: message(error) })
        return undefined
      }
    },
    tools: (scope) => collect('tools', (c) => (c.tools ? () => c.tools!(scope) : undefined)),
    readRoots: (scope) => collect('readRoots', (c) => (c.readRoots ? () => c.readRoots!(scope) : undefined)),
    hooks: (scope) => contributions.flatMap((c) => c.hooks?.(scope) ?? []),
    admissionHooks: (scope) => contributions.flatMap((c) => c.admissionHooks?.(scope) ?? []),
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
    beforeRequest:
      checks.length === 0
        ? undefined
        : async (state, scope) => {
            for (const c of checks) {
              const verdict = await guarded(c, 'beforeRequest', undefined as RequestVerdict, () => c.beforeRequest!(state, scope))
              if (verdict) return verdict
            }
            return undefined
          },
    async pendingInput(scope) {
      const parts: PendingInput[] = []
      for (const c of contributions) {
        if (!c.pendingInput) continue
        const part = await guarded(c, 'pendingInput', undefined, () => c.pendingInput!(scope))
        if (part) parts.push(part)
      }
      if (parts.length === 0) return undefined
      return {
        content: parts.flatMap((p) => p.content),
        before: parts.flatMap((p) => p.before ?? []),
        delivered: () => {
          for (const part of parts) part.delivered()
        },
      }
    },
    async onRunEnd(scope, info) {
      for (const c of contributions) if (c.onRunEnd) await guarded(c, 'onRunEnd', undefined, () => c.onRunEnd!(scope, info))
    },
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

/** 模型请求与用量共用的工具清单：基础工具优先，同名只保留一次，再应用该 Session 的领域过滤。 */
export function availableTools(
  base: ToolRegistry,
  contributed: readonly ContributedTool[],
  context: Pick<ContextAssembly, 'filterTools'>,
  scope: ContextScope,
): CokoTool[] {
  const unique = new Map<string, CokoTool>()
  for (const tool of [...base.list(), ...contributed.map((item) => item.tool)]) {
    if (!unique.has(tool.name)) unique.set(tool.name, tool)
  }
  const visible = new Set(context.filterTools([...unique.keys()], scope))
  return [...unique.values()].filter((tool) => visible.has(tool.name))
}

/** Root Run catalog after the same visibility filtering used for execution and usage. */
export function onDemandCatalog(contributed: readonly ContributedTool[], available: readonly CokoTool[], scope: ContextScope): OnDemandTool[] {
  if (!scope.config.mcp.toolSearch || scope.parentSessionId) return []
  const availableByName = new Map(available.map((tool) => [tool.name, tool]))
  const origins = new Map(
    contributed
      .filter((item) => item.mcpServer && !item.mcpAlwaysLoad && availableByName.get(item.tool.name) === item.tool)
      .map((item) => [item.tool.name, item.mcpServer!]),
  )
  return available.flatMap((tool) =>
    origins.has(tool.name) ? [{ name: tool.name, server: origins.get(tool.name)!, description: tool.description, parameters: tool.parameters }] : [],
  )
}

/** Model execution/schema list and accounting share this selection; the registry stays complete. */
export function providedTools(
  base: ToolRegistry,
  contributed: readonly ContributedTool[],
  context: Pick<ContextAssembly, 'filterTools'>,
  scope: ContextScope,
  entries: readonly EntryLike[] = [],
): CokoTool[] {
  const available = availableTools(base, contributed, context, scope)
  const catalog = onDemandCatalog(contributed, available, scope)
  if (!catalog.length) return available
  const deferred = new Set(catalog.map((tool) => tool.name))
  const loaded = loadedToolNames(entries)
  const selected = available.filter((tool) => !deferred.has(tool.name) || loaded.has(tool.name))
  if (!selected.some((tool) => tool.name === 'tool_search'))
    selected.push(
      createToolSearch({ catalog, regularNames: available.filter((tool) => !deferred.has(tool.name)).map((tool) => tool.name), loadedNames: () => loaded }),
    )
  return selected
}

/** 运行时的工具：宿主的基础工具集加上本次 Run 贡献的工具（与基础工具同名的贡献被忽略并记 warn）。 */
export function layeredTools(base: ToolRegistry): {
  registry: ToolRegistry
  set(tools: readonly ContributedTool[]): void
  /** 本次 Run 可用的工具名（filterTools 的结果）；undefined 为不过滤。 */
  allow(names: ReadonlySet<string> | undefined): void
} {
  let extra = createToolRegistry()
  let allowed: ReadonlySet<string> | undefined
  const visible = (name: string) => allowed === undefined || allowed.has(name)
  return {
    allow(names) {
      allowed = names
    },
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
      get: (name) => (visible(name) ? (base.get(name) ?? extra.get(name)) : undefined),
      list: () => [...base.list(), ...extra.list()].filter((tool) => visible(tool.name)),
      implementations: () => [...base.implementations(), ...extra.implementations()].filter((tool) => visible(tool.name)),
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
