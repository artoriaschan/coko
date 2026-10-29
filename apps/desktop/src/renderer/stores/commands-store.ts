import { CommandListResponse, commandPaths, type CommandInfo } from '@coko/protocol'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'

/** 命令目录所属的作用域：会话（取其 Workspace）或还没有会话的 Workspace 草稿。 */
export type CommandTarget = { sessionId: string } | { workspaceId: string }

export const targetKey = (target: CommandTarget) => ('sessionId' in target ? `session:${target.sessionId}` : `workspace:${target.workspaceId}`)

export interface CommandsState {
  /** 最近一次读取对应的作用域。 */
  key: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  commands: CommandInfo[]
}

export interface CommandsActions {
  /**
   * 读取该作用域的命令目录（Sidecar 每次请求重新列目录，文件按 mtime 读取）。切换作用域时先清空；同一作用域刷新失败时保留上次的目录。
   * 较早发出的请求晚到时被丢弃。
   */
  load(target: CommandTarget): Promise<void>
}

export type CommandsStore = StoreApi<CommandsState & CommandsActions>

export type FetchCommands = (target: CommandTarget) => Promise<CommandListResponse>

/** GET /api/commands：同源相对路径，经 coko-app:// 代理附加认证；响应在信任边界按 schema 校验。 */
export function httpFetchCommands(fetchImpl: (input: string) => Promise<Response> = (input) => fetch(input)): FetchCommands {
  return async (target) => {
    const query = 'sessionId' in target ? `sessionId=${encodeURIComponent(target.sessionId)}` : `workspaceId=${encodeURIComponent(target.workspaceId)}`
    const path = `${commandPaths.commands}?${query}`
    const response = await fetchImpl(path)
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok || !Value.Check(CommandListResponse, value)) throw new Error(`GET ${path} failed with status ${response.status}`)
    return value
  }
}

/** 命令目录的 vanilla store（无 React 依赖）：composer 的 / 菜单读取它。 */
export function createCommandsStore(fetchCommands: FetchCommands = httpFetchCommands()): CommandsStore {
  let latest = 0
  return createStore<CommandsState & CommandsActions>()((set, get) => ({
    key: null,
    status: 'idle',
    commands: [],
    async load(target) {
      const key = targetKey(target)
      const request = ++latest
      if (get().key !== key) set({ key, status: 'loading', commands: [] })
      try {
        const { commands } = await fetchCommands(target)
        if (request === latest) set({ status: 'ready', commands })
      } catch {
        if (request === latest) set({ status: get().commands.length > 0 ? 'ready' : 'error' })
      }
    },
  }))
}

/** 应用内共用的 store。 */
export const commandsStore: CommandsStore = createCommandsStore()
