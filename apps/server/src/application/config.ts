import { join } from 'node:path'
import {
  CONFIG_SETTING_KEY,
  createMtimeCache,
  createNodeFiles,
  diagnostic,
  mergeCapabilityConfig,
  parseProjectSettings,
  type CapabilityConfig,
  type CapabilityConfigPatch,
  type MtimeCache,
  type ProjectCapabilityValues,
  type ProjectSettings,
  type ReadOnlyFiles,
  type ResourceDiagnostic as AgentResourceDiagnostic,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import {
  CapabilityConfigValues,
  CONFIG_SETTING,
  parsePermissionRule,
  PROJECT_SETTINGS_PATH,
  type CapabilityConfig as ProtocolCapabilityConfig,
  type ConfigResponse,
  type ProjectConfig,
  type ProjectConfigValues,
  type ResourceDiagnostic as ProtocolResourceDiagnostic,
  type UpdateConfigRequest,
} from '@coko/protocol'
import type { JsonValue, SessionStore } from '@coko/session'
import { Value } from 'typebox/value'
import { AppError } from './errors.ts'
import type { ProjectRuleSource } from './permissions.ts'

// 能力配置的两份定义（@coko/agent 合并、@coko/protocol 在信任边界校验）必须一致：一侧改了而另一侧未跟上时这里编译失败。
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T
export type CapabilityConfigsAgree = Assert<Equal<CapabilityConfig, ProtocolCapabilityConfig>>
export type ConfigSettingKeysAgree = Assert<Equal<typeof CONFIG_SETTING_KEY, typeof CONFIG_SETTING>>
export type ProjectValuesAgree = Assert<Equal<ProjectCapabilityValues, Omit<ProjectConfigValues, 'permissions'>>>
export type DiagnosticsAgree = Assert<Equal<AgentResourceDiagnostic, ProtocolResourceDiagnostic>>

const log = getLogger(['application', 'config'])

/** 一次读取的项目设置文件。 */
interface ProjectSnapshot {
  path: string
  exists: boolean
  settings: ProjectSettings
}

const emptySettings = (): ProjectSettings => ({ values: {}, rules: { deny: [], ask: [] }, diagnostics: [] })

export interface ConfigServiceOptions {
  /** 全局值（设置键 config）所在的存储；省略时全局为空（只有默认与项目）。 */
  store?: SessionStore
  /** 读取项目文件的端口；缺省 Node 实现。 */
  files?: ReadOnlyFiles
}

/**
 * 有效能力配置（默认 ← 全局设置键 config ← 项目 <Workspace>/.coko/settings.json，ADR 0008）。项目文件在每个 Run 开始（effective）、
 * GET /api/config 与 GET /api/permissions 时按 mtime 读取；读取失败或格式错误只产生诊断。项目的 permissions.deny / ask 经
 * ProjectRuleSource 交给 PermissionService，作为只读的 project 作用域参与判定。
 */
export class ConfigService implements ProjectRuleSource {
  readonly #store: SessionStore | undefined
  readonly #cache: MtimeCache<ProjectSettings>
  /** 每个 Workspace 目录最近一次读到的项目设置（判定时同步读取）。 */
  readonly #latest = new Map<string, ProjectSnapshot>()

  constructor(options: ConfigServiceOptions = {}) {
    this.#store = options.store
    const files = options.files ?? createNodeFiles()
    this.#cache = createMtimeCache(files, (text, path) => parseProjectSettings(text, path, { isRule: (rule) => parsePermissionRule(rule) !== undefined }))
  }

  /** 有效配置；workspacePath：项目设置所在的 Workspace，省略时只有默认与全局。 */
  async effective(workspacePath?: string): Promise<CapabilityConfig> {
    const [global, project] = await Promise.all([this.#global(), workspacePath === undefined ? undefined : this.#project(workspacePath)])
    return mergeCapabilityConfig(global.value, project?.settings.values)
  }

  /** GET /api/config：给出 workspaceId 时含该 Workspace 的项目文件。Workspace 不存在时 not-found。 */
  async get(workspaceId?: string): Promise<ConfigResponse> {
    const workspacePath = workspaceId === undefined ? undefined : await this.#workspacePath(workspaceId)
    const [global, project] = await Promise.all([this.#global(), workspacePath === undefined ? undefined : this.#project(workspacePath)])
    return {
      effective: mergeCapabilityConfig(global.value, project?.settings.values),
      global: global.value,
      globalRevision: global.revision,
      ...(project ? { project: projectDto(project) } : {}),
    }
  }

  /** PUT /api/config：整体替换全局值；revision 不一致时 revision-conflict（存储层抛出）。 */
  async update(request: UpdateConfigRequest): Promise<ConfigResponse> {
    if (request.workspaceId !== undefined) await this.#workspacePath(request.workspaceId)
    await this.#requireStore().settings.set(CONFIG_SETTING_KEY, request.values as JsonValue, request.expectedRevision)
    log.info('capability config saved', { revision: request.expectedRevision + 1 })
    return this.get(request.workspaceId)
  }

  // ---- ProjectRuleSource（PermissionService 的 project 作用域） ----

  /** 最近一次读到的项目规则文本（尚未读过时为空）。 */
  projectRules(workspacePath: string): ProjectSettings['rules'] {
    return this.#latest.get(workspacePath)?.settings.rules ?? { deny: [], ask: [] }
  }

  /** 重新读取（按 mtime）项目文件，返回其路径与规则文本。 */
  async readProjectRules(workspacePath: string): Promise<{ path: string; rules: ProjectSettings['rules'] }> {
    const snapshot = await this.#project(workspacePath)
    return { path: snapshot.path, rules: snapshot.settings.rules }
  }

  #requireStore(): SessionStore {
    if (!this.#store) throw new AppError('internal', 'Config store is not available')
    return this.#store
  }

  async #workspacePath(workspaceId: string): Promise<string> {
    const workspace = await this.#requireStore().sessions.getWorkspace(workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
    return workspace.path
  }

  /** 全局值：不合 schema 时按空处理并记 warn（只经本服务写入，正常不会出现）。 */
  async #global(): Promise<{ value: CapabilityConfigPatch; revision: number }> {
    const setting = await this.#store?.settings.get(CONFIG_SETTING_KEY)
    if (!setting) return { value: {}, revision: 0 }
    if (Value.Check(CapabilityConfigValues, setting.value)) return { value: setting.value as CapabilityConfigPatch, revision: setting.revision }
    log.warn('capability config ignored: invalid value', { revision: setting.revision })
    return { value: {}, revision: setting.revision }
  }

  async #project(workspacePath: string): Promise<ProjectSnapshot> {
    const path = join(workspacePath, PROJECT_SETTINGS_PATH)
    let snapshot: ProjectSnapshot
    try {
      const settings = await this.#cache.load(path)
      snapshot = settings ? { path, exists: true, settings } : { path, exists: false, settings: emptySettings() }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('project settings unreadable', { path, error: message })
      snapshot = {
        path,
        exists: true,
        settings: { ...emptySettings(), diagnostics: [diagnostic('config', 'read-failed', `Cannot read file: ${message}`, path)] },
      }
    }
    this.#latest.set(workspacePath, snapshot)
    return snapshot
  }
}

function projectDto(snapshot: ProjectSnapshot): ProjectConfig {
  const { values, rules, diagnostics } = snapshot.settings
  const hasRules = rules.deny.length > 0 || rules.ask.length > 0
  return {
    path: snapshot.path,
    exists: snapshot.exists,
    values: { ...structuredClone(values), ...(hasRules ? { permissions: { deny: [...rules.deny], ask: [...rules.ask] } } : {}) },
    diagnostics: diagnostics.map((d) => ({ ...d })),
  }
}
