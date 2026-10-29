import {
  ConfigResponse,
  configPaths,
  ErrorResponse,
  SkillListResponse,
  skillPaths,
  type CapabilityConfigValues,
  type CommandInfo,
  type ResourceDiagnostic,
  type SkillInfo,
} from '@coko/protocol'
import type { Static, TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { httpFetchCommands } from './commands-store.ts'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** 请求失败：code 为协议错误码，或 network / bad-response。 */
export class SkillsRequestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'SkillsRequestError'
    this.code = code
  }
}

/** GET /api/skills、GET /api/commands 与 PUT /api/config（skills.* / commands.disabled）；同源相对路径，响应在信任边界按 schema 校验。 */
export function createSkillsClient(fetchImpl: Fetch = (input, init) => fetch(input, init)) {
  async function call<S extends TSchema>(schema: S, method: string, path: string, body?: unknown): Promise<Static<S>> {
    let response: Response
    try {
      response = await fetchImpl(path, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      })
    } catch (error) {
      throw new SkillsRequestError('network', error instanceof Error ? error.message : String(error))
    }
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      if (Value.Check(ErrorResponse, value)) throw new SkillsRequestError(value.error.code, value.error.message)
      throw new SkillsRequestError('bad-response', `${method} ${path} failed with status ${response.status}`)
    }
    if (!Value.Check(schema, value)) throw new SkillsRequestError('bad-response', `Unexpected response for ${method} ${path}`)
    return value as Static<S>
  }
  const scoped = (path: string, workspaceId: string) => `${path}?workspaceId=${encodeURIComponent(workspaceId)}`
  const fetchCommands = httpFetchCommands((input) => fetchImpl(input))
  return {
    skills: (workspaceId: string) => call(SkillListResponse, 'GET', scoped(skillPaths.skills, workspaceId)),
    commands: (workspaceId: string) => fetchCommands({ workspaceId }),
    config: (workspaceId: string) => call(ConfigResponse, 'GET', scoped(configPaths.config, workspaceId)),
    /** 读取全局值与 revision 后整体替换（PUT /api/config 只接受整份全局值，其他全局键原样带回）。 */
    async updateGlobal(workspaceId: string, change: (global: CapabilityConfigValues) => CapabilityConfigValues): Promise<ConfigResponse> {
      const current = await call(ConfigResponse, 'GET', scoped(configPaths.config, workspaceId))
      return call(ConfigResponse, 'PUT', configPaths.config, { values: change(current.global), expectedRevision: current.globalRevision, workspaceId })
    },
  }
}

export type SkillsClient = ReturnType<typeof createSkillsClient>

/** 名字列表中加入（停用）或去掉（启用）一个名字，保持其余顺序。 */
export function toggleName(list: readonly string[] | undefined, name: string, enabled: boolean): string[] {
  const rest = (list ?? []).filter((n) => n !== name)
  return enabled ? rest : [...rest, name]
}

export interface SkillsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 最近一次读取对应的 Workspace；没有 Workspace 时为 null（不读取）。 */
  workspaceId: string | null
  skills: SkillInfo[]
  /** 可在此启停的命令：项目、用户模板与 MCP 提示模板（内置命令总是启用，Skill 命令随 Skill）。 */
  commands: CommandInfo[]
  /** Skill 与命令的加载诊断。 */
  diagnostics: ResourceDiagnostic[]
  config: ConfigResponse | null
}

export interface SkillsActions {
  /** 读取该 Workspace 的 Skill、命令与配置；较早发出的请求晚到时被丢弃。 */
  load(workspaceId?: string): Promise<void>
  /** 以下操作写入全局配置后重新读取；失败时抛出 SkillsRequestError，列表不变。 */
  setSkillsEnabled(enabled: boolean): Promise<void>
  setSkillEnabled(name: string, enabled: boolean): Promise<void>
  setCommandEnabled(name: string, enabled: boolean): Promise<void>
}

export type SkillsStore = StoreApi<SkillsState & SkillsActions>

const TOGGLEABLE_SOURCES = new Set<CommandInfo['source']>(['project', 'user', 'mcp'])

/** 设置弹窗 Skills & Commands 分区的 vanilla store（无 React 依赖）。 */
export function createSkillsStore(client: SkillsClient = createSkillsClient()): SkillsStore {
  let latest = 0
  return createStore<SkillsState & SkillsActions>()((set, get) => {
    const update = async (change: (global: CapabilityConfigValues) => CapabilityConfigValues) => {
      const workspaceId = get().workspaceId
      if (workspaceId === null) return
      await client.updateGlobal(workspaceId, change)
      await get().load(workspaceId)
    }
    return {
      status: 'idle',
      workspaceId: null,
      skills: [],
      commands: [],
      diagnostics: [],
      config: null,
      async load(workspaceId) {
        const request = ++latest
        if (workspaceId === undefined) {
          set({ status: 'idle', workspaceId: null, skills: [], commands: [], diagnostics: [], config: null })
          return
        }
        set((state) =>
          state.workspaceId === workspaceId && state.status === 'ready'
            ? {}
            : { status: 'loading', workspaceId, skills: [], commands: [], diagnostics: [], config: null },
        )
        try {
          const [skills, commands, config] = await Promise.all([client.skills(workspaceId), client.commands(workspaceId), client.config(workspaceId)])
          if (request !== latest) return
          set({
            status: 'ready',
            skills: skills.skills,
            commands: commands.commands.filter((c) => TOGGLEABLE_SOURCES.has(c.source)),
            diagnostics: [...skills.diagnostics, ...commands.diagnostics.filter((d) => d.source !== 'skills')],
            config,
          })
        } catch {
          if (request === latest) set({ status: 'error' })
        }
      },
      setSkillsEnabled: (enabled) => update((g) => ({ ...g, skills: { ...g.skills, enabled } })),
      setSkillEnabled: (name, enabled) => update((g) => ({ ...g, skills: { ...g.skills, disabled: toggleName(g.skills?.disabled, name, enabled) } })),
      setCommandEnabled: (name, enabled) => update((g) => ({ ...g, commands: { ...g.commands, disabled: toggleName(g.commands?.disabled, name, enabled) } })),
    }
  })
}

/** 应用内共用的 store。 */
export const skillsStore: SkillsStore = createSkillsStore()
