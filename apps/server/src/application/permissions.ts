import { canonicalRuleTool, ruleToolName, type PermissionClass, type PermissionRule, type ProjectRuleTexts } from '@coko/agent'
import { getLogger } from '@coko/logging'
import {
  parsePermissionRule,
  PERMISSIONS_DEFAULT_MODE_SETTING,
  PERMISSIONS_RULES_SETTING,
  PermissionRuleList,
  StandardPermissionMode,
  workspaceRulesSetting,
  type PermissionsResponse,
  type UpdatePermissionsRequest,
} from '@coko/protocol'
import type { JsonValue, SessionStore } from '@coko/session'
import type { TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { AppError } from './errors.ts'

const log = getLogger(['application', 'permissions'])

interface Stored<T> {
  value: T
  revision: number
}

const sameRule = (a: PermissionRule, b: PermissionRule) => a.behavior === b.behavior && a.tool === b.tool && a.content === b.content

/** 不重复地追加规则。 */
export function withRules(rules: readonly PermissionRule[], added: readonly PermissionRule[]): PermissionRule[] {
  const next = [...rules]
  for (const rule of added) if (!next.some((r) => sameRule(r, rule))) next.push(rule)
  return next
}

export { sameRule }

/**
 * 宿主工具名：names 为按原名书写规则的工具（不区分大小写匹配）；aliases 为规则名不同于工具名的贡献工具（小写工具名 → 规则名，
 * 例如 memory_write → Memory）。
 */
export interface HostToolNames {
  names: readonly string[]
  aliases?: Readonly<Record<string, string>>
}

/** 只为取工具名而构造宿主工具集时用的固定目录（工具集的名字与 Workspace 无关；构造不访问该目录）。 */
const TOOL_NAMES_CWD = '/'

/**
 * 写规则时可用的工具名：宿主注册的工具（第一次需要时从工具工厂读取），以及贡献声明的规则工具按其规则名
 * （memory_write / memory_delete → Memory，其余为原名）。
 */
export function hostToolNames(options: {
  tools?: (cwd: string) => { list(): readonly { name: string }[] }
  ruleTools: readonly { name: string; permissionClass: PermissionClass }[]
}): () => HostToolNames {
  let names: readonly string[] | undefined
  const aliases = Object.fromEntries(options.ruleTools.map(({ name, permissionClass }) => [name.toLowerCase(), ruleToolName(name, permissionClass)]))
  return () => {
    names ??= options.tools
      ? options
          .tools(TOOL_NAMES_CWD)
          .list()
          .map((tool) => tool.name)
      : []
    return { names, aliases }
  }
}

const toHostToolNames = (known: readonly string[] | HostToolNames): HostToolNames => ('names' in known ? known : { names: known as readonly string[] })

/** policy 的组名与内置别名（含 Skill、mcp__）优先，其次贡献工具的规则名，最后宿主工具名。 */
const canonicalTool = (tool: string, known: HostToolNames) =>
  canonicalRuleTool(tool) ?? known.aliases?.[tool.toLowerCase()] ?? canonicalRuleTool(tool, known.names)

/**
 * 写入的规则：工具名归一为规范名（内置工具与组名不区分大小写归为 Read / Edit / Bash，宿主工具按注册名，贡献工具按其规则名），重复的合并。
 * 未知工具名以 bad-request 拒绝（details.reason = unknown-tool），否则这条规则永远不会命中。
 */
export function normalizeRules(rules: readonly PermissionRule[], known: readonly string[] | HostToolNames): PermissionRule[] {
  const host = toHostToolNames(known)
  return withRules(
    [],
    rules.map((rule) => {
      const tool = canonicalTool(rule.tool, host)
      if (tool === undefined) throw new AppError('bad-request', `Unknown tool in permission rule: ${rule.tool}`, { reason: 'unknown-tool', tool: rule.tool })
      return { ...rule, tool }
    }),
  )
}

/** 读入的规则：库中已有的非规范写法按规范名读出（未知工具名保持原样），重复的合并。 */
export function canonicalRules(rules: readonly PermissionRule[], known: readonly string[] | HostToolNames): PermissionRule[] {
  const host = toHostToolNames(known)
  return withRules(
    [],
    rules.map((rule) => ({ ...rule, tool: canonicalTool(rule.tool, host) ?? rule.tool })),
  )
}

/**
 * project 作用域的来源（ConfigService）：Workspace 的 .coko/settings.json 中的 permissions.deny / ask（ADR 0008）。
 * rules 同步给出最近一次读到的值（每个 Run 开始时 ConfigService.effective 重新读取）；read 按 mtime 重新读取。
 */
export interface ProjectRuleSource {
  projectRules(workspacePath: string): ProjectRuleTexts
  readProjectRules(workspacePath: string): Promise<{ path: string; rules: ProjectRuleTexts }>
}

/** 项目规则文本 → 规则（文本已由 ConfigService 校验，不合法的已作为诊断剔除）。 */
function projectRules(texts: ProjectRuleTexts): PermissionRule[] {
  return (['deny', 'ask'] as const).flatMap((behavior) =>
    texts[behavior].flatMap((text) => {
      const parsed = parsePermissionRule(text)
      return parsed ? [{ behavior, ...parsed }] : []
    }),
  )
}

/**
 * 默认模式、全局与 Workspace 规则（设置键 permissions.*，ADR 0005），以及只读的 project 规则（ProjectRuleSource）。值在读入时按 schema 校验，不合格时按缺省处理并记 warn；
 * 只经本服务写入（通用设置接口拒绝 permissions.*），因此内存中的值与 revision 与库一致，判定时同步读取。
 */
export class PermissionService {
  readonly #store: SessionStore
  /** 宿主注册的工具名（内置工具之外的，用于规则工具名的归一与校验）。 */
  readonly #toolNames: () => readonly string[] | HostToolNames
  #loaded: Promise<void> | undefined
  #defaultMode: Stored<StandardPermissionMode> = { value: 'default', revision: 0 }
  #global: Stored<PermissionRule[]> = { value: [], revision: 0 }
  readonly #workspaces = new Map<string, Promise<void>>()
  readonly #workspaceValues = new Map<string, Stored<PermissionRule[]>>()
  /** Workspace 目录（project 规则按目录读取）。 */
  readonly #workspacePaths = new Map<string, string>()
  #project: ProjectRuleSource | undefined

  constructor(store: SessionStore, toolNames: () => readonly string[] | HostToolNames = () => []) {
    this.#store = store
    this.#toolNames = toolNames
  }

  /** 接入 project 作用域（runtime 层装配时调用一次）。 */
  useProjectRules(source: ProjectRuleSource): void {
    this.#project = source
  }

  /** 写入前归一并校验规则（见 normalizeRules）。 */
  normalize(rules: readonly PermissionRule[]): PermissionRule[] {
    return normalizeRules(rules, this.#toolNames())
  }

  /** 读出时归一库中的规则（见 canonicalRules）。 */
  canonical(rules: readonly PermissionRule[]): PermissionRule[] {
    return canonicalRules(rules, this.#toolNames())
  }

  async #readRules(key: string): Promise<Stored<PermissionRule[]>> {
    const stored = await this.#read(key, PermissionRuleList, [] as PermissionRule[])
    return { value: this.canonical(stored.value), revision: stored.revision }
  }

  async #read<T>(key: string, schema: TSchema, fallback: T): Promise<Stored<T>> {
    const setting = await this.#store.settings.get(key)
    if (!setting) return { value: fallback, revision: 0 }
    if (Value.Check(schema, setting.value)) return { value: setting.value as T, revision: setting.revision }
    log.warn('permission setting ignored: invalid value', { key, revision: setting.revision })
    return { value: fallback, revision: setting.revision }
  }

  /** 读入默认模式与全局规则（一次）。 */
  load(): Promise<void> {
    this.#loaded ??= (async () => {
      this.#defaultMode = await this.#read(PERMISSIONS_DEFAULT_MODE_SETTING, StandardPermissionMode, 'default' as StandardPermissionMode)
      this.#global = await this.#readRules(PERMISSIONS_RULES_SETTING)
    })().catch((error: unknown) => {
      this.#loaded = undefined
      throw error
    })
    return this.#loaded
  }

  /** 读入某个 Workspace 的规则与目录（一次），并读一次其项目规则（之后每个 Run 开始时刷新）。 */
  loadWorkspace(workspaceId: string): Promise<void> {
    let loading = this.#workspaces.get(workspaceId)
    if (!loading) {
      loading = (async () => {
        const [stored, workspace] = await Promise.all([this.#readRules(workspaceRulesSetting(workspaceId)), this.#store.sessions.getWorkspace(workspaceId)])
        if (!this.#workspaceValues.has(workspaceId)) this.#workspaceValues.set(workspaceId, stored)
        if (workspace) {
          this.#workspacePaths.set(workspaceId, workspace.path)
          await this.#project?.readProjectRules(workspace.path)
        }
      })()
      loading.catch(() => this.#workspaces.delete(workspaceId))
      this.#workspaces.set(workspaceId, loading)
    }
    return loading
  }

  async #workspaceRules(workspaceId: string): Promise<Stored<PermissionRule[]>> {
    await this.loadWorkspace(workspaceId)
    return this.#workspaceValues.get(workspaceId)!
  }

  async defaultMode(): Promise<StandardPermissionMode> {
    await this.load()
    return this.#defaultMode.value
  }

  /**
   * 全局、该 Workspace 与其项目（project 作用域，只有 deny / ask）的规则；调用前须已 load() 与 loadWorkspace()。项目规则从会话的工作目录读取
   * （cwd；worktree 会话为 worktree 中的目录，缺省 Workspace 目录），批准与 Workspace 作用域的规则仍按 Workspace。
   */
  rulesFor(workspaceId: string, cwd?: string): PermissionRule[] {
    const path = cwd ?? this.#workspacePaths.get(workspaceId)
    const project = path !== undefined && this.#project ? this.canonical(projectRules(this.#project.projectRules(path))) : []
    return [...this.#global.value, ...(this.#workspaceValues.get(workspaceId)?.value ?? []), ...project]
  }

  async get(workspaceId?: string): Promise<PermissionsResponse> {
    await this.load()
    const response: PermissionsResponse = {
      defaultMode: { ...this.#defaultMode },
      global: { rules: [...this.#global.value], revision: this.#global.revision },
    }
    if (workspaceId !== undefined) {
      await this.#workspace(workspaceId)
      const stored = await this.#workspaceRules(workspaceId)
      response.workspace = { workspaceId, rules: [...stored.value], revision: stored.revision }
      const path = this.#workspacePaths.get(workspaceId)
      if (path !== undefined && this.#project) {
        const project = await this.#project.readProjectRules(path)
        response.project = { workspaceId, path: project.path, rules: this.canonical(projectRules(project.rules)) }
      }
    }
    return response
  }

  async #workspace(workspaceId: string): Promise<void> {
    if (!(await this.#store.sessions.getWorkspace(workspaceId))) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
  }

  async #set<T>(key: string, value: T, expectedRevision: number): Promise<Stored<T>> {
    const saved = await this.#store.settings.set(key, value as JsonValue, expectedRevision)
    return { value: saved.value as T, revision: saved.revision }
  }

  /** 修改一项；revision 不一致时 revision-conflict。 */
  async update(request: UpdatePermissionsRequest): Promise<PermissionsResponse> {
    await this.load()
    switch (request.target) {
      case 'defaultMode':
        this.#defaultMode = await this.#set(PERMISSIONS_DEFAULT_MODE_SETTING, request.value, request.expectedRevision)
        return this.get()
      case 'global':
        this.#global = await this.#set(PERMISSIONS_RULES_SETTING, this.normalize(request.rules), request.expectedRevision)
        return this.get()
      case 'workspace': {
        const rules = this.normalize(request.rules)
        await this.#workspace(request.workspaceId)
        await this.loadWorkspace(request.workspaceId)
        this.#workspaceValues.set(request.workspaceId, await this.#set(workspaceRulesSetting(request.workspaceId), rules, request.expectedRevision))
        return this.get(request.workspaceId)
      }
    }
  }

  /** "总是允许"：把规则追加到全局或某个 Workspace（已有的不重复），基于当前 revision。 */
  async addRules(scope: { kind: 'global' } | { kind: 'workspace'; workspaceId: string }, rules: readonly PermissionRule[]): Promise<void> {
    await this.load()
    if (scope.kind === 'global') {
      this.#global = await this.#set(PERMISSIONS_RULES_SETTING, withRules(this.#global.value, rules), this.#global.revision)
      return
    }
    const stored = await this.#workspaceRules(scope.workspaceId)
    this.#workspaceValues.set(scope.workspaceId, await this.#set(workspaceRulesSetting(scope.workspaceId), withRules(stored.value, rules), stored.revision))
  }
}
