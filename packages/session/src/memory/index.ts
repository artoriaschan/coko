// 内存实现：语义与 SQLite 实现一致（同一组契约测试），用于单元测试；不持久化。
import { randomUUID } from 'node:crypto'
import { closedError, defaultWorkspaceName, notFound, revisionConflict, upgradeEntries } from '../internal.ts'
import { checkNewEntries } from '../payloads.ts'
import type { JsonValue, Provider, ProviderInput, Session, SessionEntry, SessionModel, SessionStore, Setting, StoreOptions, Workspace } from '../types.ts'

interface ProviderRow {
  provider: Omit<Provider, 'credential'>
  credential: { ciphertext: Uint8Array; hint: string } | null
}

export function createMemoryStore(options: StoreOptions): SessionStore {
  const now = options.now ?? Date.now
  let closed = false
  const workspaces = new Map<string, Workspace>()
  const sessions = new Map<string, Session>()
  const entries = new Map<string, SessionEntry[]>()
  const settings = new Map<string, Setting>()
  const providers = new Map<string, ProviderRow>()

  // 读写都复制，调用方修改返回值不影响已提交的状态。
  const copy = <T>(value: T): T => structuredClone(value)
  // 与 SQLite 实现一致：同步错误转为 rejection，关闭后拒绝。
  const op =
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    async (...args: A): Promise<R> => {
      if (closed) throw closedError()
      return copy(fn(...args))
    }

  const requireSession = (id: string): Session => {
    const session = sessions.get(id)
    if (!session) throw notFound('session', id)
    return session
  }
  const requireProvider = (id: string): ProviderRow => {
    const row = providers.get(id)
    if (!row) throw notFound('provider', id)
    return row
  }
  const toProvider = (row: ProviderRow): Provider => ({ ...row.provider, credential: row.credential ? { hint: row.credential.hint } : null })
  const touch = (session: Session, patch: Partial<Session>): Session => {
    Object.assign(session, patch, { updatedAt: now() })
    return session
  }

  return {
    sessions: {
      registerWorkspace: op((input: { path: string; name?: string }) => {
        for (const w of workspaces.values()) if (w.path === input.path) return w
        const workspace: Workspace = { id: randomUUID(), path: input.path, name: input.name ?? defaultWorkspaceName(input.path), createdAt: now() }
        workspaces.set(workspace.id, workspace)
        return workspace
      }),
      listWorkspaces: op(() => [...workspaces.values()]),
      getWorkspace: op((id: string) => workspaces.get(id)),
      createSession: op((input: { workspaceId: string; title?: string; model?: SessionModel | null }) => {
        if (!workspaces.has(input.workspaceId)) throw notFound('workspace', input.workspaceId)
        const at = now()
        const session: Session = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          title: input.title ?? '',
          model: input.model ?? null,
          createdAt: at,
          updatedAt: at,
        }
        sessions.set(session.id, session)
        entries.set(session.id, [])
        return session
      }),
      listSessions: op((filter?: { workspaceId?: string }) =>
        [...sessions.values()]
          .map((session, index) => ({ session, index }))
          .filter(({ session }) => filter?.workspaceId === undefined || session.workspaceId === filter.workspaceId)
          .sort((a, b) => b.session.updatedAt - a.session.updatedAt || b.index - a.index)
          .map(({ session }) => session),
      ),
      getSession: op((id: string) => sessions.get(id)),
      setSessionTitle: op((id: string, title: string) => touch(requireSession(id), { title })),
      setSessionModel: op((id: string, model: SessionModel | null) => touch(requireSession(id), { model: copy(model) })),
      appendEntries: op((sessionId: string, input: readonly { kind: string; payloadVersion?: number; payload: JsonValue; runId?: string }[]) => {
        const session = requireSession(sessionId)
        if (input.length === 0) return []
        const versions = checkNewEntries(options.payloads, input)
        const list = entries.get(sessionId) ?? []
        const at = now()
        const added = input.map((entry, i): SessionEntry => ({
          sessionId,
          seq: list.length + i + 1,
          kind: entry.kind,
          payloadVersion: versions[i]!,
          payload: copy(entry.payload),
          runId: entry.runId ?? null,
          createdAt: at,
        }))
        list.push(...added)
        session.updatedAt = at
        return added
      }),
      listEntries: op((sessionId: string, range?: { afterSeq?: number; limit?: number }) => {
        const after = (entries.get(sessionId) ?? []).filter((e) => e.seq > (range?.afterSeq ?? 0))
        return upgradeEntries(range?.limit === undefined ? after : after.slice(0, range.limit), options)
      }),
    },
    settings: {
      get: op((key: string) => settings.get(key)),
      list: op(() => [...settings.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))),
      set: op((key: string, value: JsonValue, expectedRevision: number) => {
        const actual = settings.get(key)?.revision ?? 0
        if (actual !== expectedRevision) throw revisionConflict(key, expectedRevision, actual)
        const setting: Setting = { key, value: copy(value), revision: actual + 1, updatedAt: now() }
        settings.set(key, setting)
        return setting
      }),
    },
    providers: {
      list: op(() => [...providers.values()].map(toProvider)),
      get: op((id: string) => {
        const row = providers.get(id)
        return row ? toProvider(row) : undefined
      }),
      create: op((input: ProviderInput) => {
        const at = now()
        const row: ProviderRow = { provider: { id: randomUUID(), ...copy(input), createdAt: at, updatedAt: at }, credential: null }
        providers.set(row.provider.id, row)
        return toProvider(row)
      }),
      update: op((id: string, patch: Partial<ProviderInput>) => {
        const row = requireProvider(id)
        Object.assign(row.provider, copy(patch), { updatedAt: now() })
        return toProvider(row)
      }),
      delete: op((id: string) => {
        requireProvider(id)
        providers.delete(id)
      }),
      setCredential: op((id: string, credential: { ciphertext: Uint8Array; hint: string }) => {
        const row = requireProvider(id)
        row.credential = { ciphertext: new Uint8Array(credential.ciphertext), hint: credential.hint }
        row.provider.updatedAt = now()
        return toProvider(row)
      }),
      clearCredential: op((id: string) => {
        const row = requireProvider(id)
        row.credential = null
        row.provider.updatedAt = now()
        return toProvider(row)
      }),
      getCredentialCiphertext: op((id: string) => {
        const ciphertext = providers.get(id)?.credential?.ciphertext
        return ciphertext ? new Uint8Array(ciphertext) : undefined
      }),
    },
    async close() {
      closed = true
    },
  }
}
