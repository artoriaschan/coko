import { McpResponse, mcpPaths, secretPaths, SecretsResponse, type McpServersConfig } from '@coko/protocol'
import type { Static, TSchema } from 'typebox'
import { Value } from 'typebox/value'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { CokoBridge, SetSecretResult } from '../../shared/bridge.ts'

// MCP 分区的 vanilla store（票 07）：GET /api/mcp 与 /api/secrets 的读取、全局配置整体替换（409 时读回）、项目 Server 的批准、重连，
// 以及经 preload setSecret 登记 Secret（值不经 HTTP，ADR 0007）。响应在信任边界按 schema 校验。

export interface McpState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 最近一次读取对应的 Workspace；没有时为 null（只有全局 Server，无连接状态）。 */
  workspaceId: string | null
  data: McpResponse | null
  secrets: SecretsResponse | null
}

export type McpActionResult = { ok: true } | { ok: false; code: string; message: string }

export interface McpActions {
  load(workspaceId?: string): Promise<void>
  loadSecrets(): Promise<void>
  /** 以当前全局配置为基础，fn 给出新的全局配置；revision 冲突时读回并返回 revision-conflict。 */
  updateServers(fn: (current: McpServersConfig) => McpServersConfig): Promise<McpActionResult>
  approve(name: string, digest: string, approve: boolean): Promise<McpActionResult>
  reconnect(name: string): Promise<McpActionResult>
  setSecret(name: string, value: string): Promise<SetSecretResult>
  deleteSecret(name: string): Promise<McpActionResult>
}

export type McpStore = StoreApi<McpState & McpActions>

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface McpStoreOptions {
  fetch?: Fetch
  setSecret?: CokoBridge['setSecret'] | undefined
}

async function json<S extends TSchema>(response: Response, schema: S): Promise<{ ok: true; value: Static<S> } | { ok: false; code: string; message: string }> {
  const body: unknown = await response.json().catch(() => undefined)
  if (response.ok && Value.Check(schema, body)) return { ok: true, value: body as Static<S> }
  const error = (body as { error?: { code?: string; message?: string } } | undefined)?.error
  return { ok: false, code: error?.code ?? 'network', message: error?.message ?? `HTTP ${response.status}` }
}

export function createMcpStore(options: McpStoreOptions = {}): McpStore {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init))
  const send = (method: string, path: string, body?: unknown) =>
    doFetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
  let latest = 0
  return createStore<McpState & McpActions>()((set, get) => {
    const workspaceQuery = () => get().workspaceId ?? undefined
    const apply = (data: McpResponse) => set({ status: 'ready', data })
    return {
      status: 'idle',
      workspaceId: null,
      data: null,
      secrets: null,
      async load(workspaceId) {
        const request = ++latest
        set((state) => ({ status: state.workspaceId === (workspaceId ?? null) && state.data ? state.status : 'loading', workspaceId: workspaceId ?? null }))
        const path = workspaceId === undefined ? mcpPaths.mcp : `${mcpPaths.mcp}?workspaceId=${encodeURIComponent(workspaceId)}`
        try {
          const result = await json(await doFetch(path), McpResponse)
          if (request !== latest) return
          if (result.ok) apply(result.value)
          else set({ status: 'error' })
        } catch {
          if (request === latest) set({ status: 'error' })
        }
      },
      async loadSecrets() {
        try {
          const result = await json(await doFetch(secretPaths.secrets), SecretsResponse)
          if (result.ok) set({ secrets: result.value })
        } catch {
          // 列表保持原样；分区显示已有内容。
        }
      },
      async updateServers(fn) {
        const data = get().data
        if (!data) return { ok: false, code: 'not-loaded', message: 'MCP settings are not loaded' }
        const workspaceId = workspaceQuery()
        const result = await json(
          await send('PUT', mcpPaths.servers, {
            servers: fn(structuredClone(data.global)),
            expectedRevision: data.globalRevision,
            ...(workspaceId ? { workspaceId } : {}),
          }),
          McpResponse,
        )
        if (result.ok) {
          latest++
          apply(result.value)
          return { ok: true }
        }
        if (result.code === 'revision-conflict') await get().load(workspaceId)
        return result
      },
      async approve(name, digest, approve) {
        const workspaceId = workspaceQuery()
        if (!workspaceId) return { ok: false, code: 'no-workspace', message: 'No workspace' }
        const result = await json(await send('POST', mcpPaths.approvals, { workspaceId, name, digest, approve }), McpResponse)
        if (!result.ok) return result
        latest++
        apply(result.value)
        return { ok: true }
      },
      async reconnect(name) {
        const workspaceId = workspaceQuery()
        if (!workspaceId) return { ok: false, code: 'no-workspace', message: 'No workspace' }
        const result = await json(await send('POST', mcpPaths.reconnect, { workspaceId, name }), McpResponse)
        if (!result.ok) return result
        latest++
        apply(result.value)
        return { ok: true }
      },
      async setSecret(name, value) {
        if (!options.setSecret) return { ok: false, code: 'sidecar-unavailable', message: 'Secrets can only be registered in the desktop app' }
        const result = await options.setSecret(name, value).catch((error: unknown): SetSecretResult => ({
          ok: false,
          code: 'sidecar-unavailable',
          message: error instanceof Error ? error.message : String(error),
        }))
        if (result.ok) await get().loadSecrets()
        return result
      },
      async deleteSecret(name) {
        const response = await send('DELETE', secretPaths.secret(name))
        if (!response.ok) {
          const failed = await json(response, SecretsResponse)
          return failed.ok ? { ok: true } : failed
        }
        await get().loadSecrets()
        return { ok: true }
      },
    }
  })
}

/** 应用内共用的 store；setSecret 来自 preload（只在 coko-app://app 主窗口中存在）。 */
export const mcpStore: McpStore = createMcpStore({
  setSecret: typeof window !== 'undefined' && window.coko ? (name, value) => window.coko!.setSecret(name, value) : undefined,
})
