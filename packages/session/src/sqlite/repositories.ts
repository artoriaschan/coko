// SessionStore 的 SQLite 实现：每个写入方法一个 BEGIN IMMEDIATE 事务。
import { randomUUID } from 'node:crypto'
import {
  alreadyExists,
  DEFAULT_MODEL_KEY,
  defaultWorkspaceName,
  modelPointsTo,
  notFound,
  revisionConflict,
  upgradeEntries,
  type StoredEntry,
} from '../internal.ts'
import { checkNewEntries } from '../payloads.ts'
import type {
  CredentialRecord,
  JsonValue,
  NewSessionEntry,
  Provider,
  ProviderRepository,
  Session,
  SessionEntry,
  SessionModel,
  SessionRepository,
  Setting,
  SettingsRepository,
  StoreOptions,
  Workspace,
} from '../types.ts'
import type { Connection } from './connection.ts'

interface WorkspaceRow {
  id: string
  path: string
  name: string
  created_at: number
}
interface SessionRow {
  id: string
  workspace_id: string
  title: string
  model_provider_id: string | null
  model_id: string | null
  thinking_level: string
  created_at: number
  updated_at: number
}
interface EntryRow {
  session_id: string
  seq: number
  kind: string
  payload_version: number
  payload: string
  run_id: string | null
  created_at: number
}
interface SettingRow {
  key: string
  value: string
  revision: number
  updated_at: number
}
interface ProviderRow {
  id: string
  name: string
  api: string
  base_url: string
  models: string
  created_at: number
  updated_at: number
  hint: string | null
}

const toWorkspace = (r: WorkspaceRow): Workspace => ({ id: r.id, path: r.path, name: r.name, createdAt: r.created_at })
const toSession = (r: SessionRow): Session => ({
  id: r.id,
  workspaceId: r.workspace_id,
  title: r.title,
  model: r.model_provider_id !== null && r.model_id !== null ? { providerId: r.model_provider_id, modelId: r.model_id } : null,
  thinkingLevel: r.thinking_level,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})
const parsePayload = (text: string): JsonValue | undefined => {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return undefined
  }
}
const toStoredEntry = (r: EntryRow): StoredEntry => ({
  sessionId: r.session_id,
  seq: r.seq,
  kind: r.kind,
  payloadVersion: r.payload_version,
  payload: parsePayload(r.payload),
  runId: r.run_id,
  createdAt: r.created_at,
})
const toSetting = (r: SettingRow): Setting => ({ key: r.key, value: JSON.parse(r.value) as JsonValue, revision: r.revision, updatedAt: r.updated_at })
const toProvider = (r: ProviderRow): Provider => ({
  id: r.id,
  name: r.name,
  api: r.api,
  baseUrl: r.base_url,
  models: JSON.parse(r.models) as JsonValue[],
  credential: r.hint === null ? null : { hint: r.hint },
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

// 同步 DatabaseSync 调用包成 Promise：同步错误转为 rejection。
const later = <T>(fn: () => T): Promise<T> => new Promise((resolve) => resolve(fn()))

const SESSION_SELECT = 'SELECT id, workspace_id, title, model_provider_id, model_id, thinking_level, created_at, updated_at FROM sessions'
const PROVIDER_SELECT = `SELECT p.id, p.name, p.api, p.base_url, p.models, p.created_at, p.updated_at, c.hint
  FROM providers p LEFT JOIN provider_credentials c ON c.provider_id = p.id`

export function createSessionRepository(conn: Connection, payloads: Pick<StoreOptions, 'payloads' | 'onInvalidEntry'>): SessionRepository {
  const getSession = (id: string) => conn.get<SessionRow>(`${SESSION_SELECT} WHERE id = ?`, id)
  const requireSession = (id: string): SessionRow => {
    const row = getSession(id)
    if (!row) throw notFound('session', id)
    return row
  }

  return {
    registerWorkspace: (input) =>
      later(() =>
        conn.write(() => {
          const existing = conn.get<WorkspaceRow>('SELECT id, path, name, created_at FROM workspaces WHERE path = ?', input.path)
          if (existing) return toWorkspace(existing)
          const workspace: Workspace = { id: randomUUID(), path: input.path, name: input.name ?? defaultWorkspaceName(input.path), createdAt: conn.now() }
          conn.run('INSERT INTO workspaces (id, path, name, created_at) VALUES (?, ?, ?, ?)', workspace.id, workspace.path, workspace.name, workspace.createdAt)
          return workspace
        }),
      ),
    listWorkspaces: () =>
      later(() => conn.read(() => conn.all<WorkspaceRow>('SELECT id, path, name, created_at FROM workspaces ORDER BY created_at, rowid').map(toWorkspace))),
    getWorkspace: (id) =>
      later(() =>
        conn.read(() => {
          const row = conn.get<WorkspaceRow>('SELECT id, path, name, created_at FROM workspaces WHERE id = ?', id)
          return row ? toWorkspace(row) : undefined
        }),
      ),
    createSession: (input) =>
      later(() =>
        conn.write(() => {
          if (!conn.get('SELECT 1 FROM workspaces WHERE id = ?', input.workspaceId)) throw notFound('workspace', input.workspaceId)
          const at = conn.now()
          const model = input.model ?? null
          const id = randomUUID()
          conn.run(
            'INSERT INTO sessions (id, workspace_id, title, model_provider_id, model_id, thinking_level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            id,
            input.workspaceId,
            input.title ?? '',
            model?.providerId ?? null,
            model?.modelId ?? null,
            (model && input.thinkingLevel) || 'off',
            at,
            at,
          )
          return toSession(requireSession(id))
        }),
      ),
    listSessions: (filter) =>
      later(() =>
        conn.read(() => {
          const rows =
            filter?.workspaceId === undefined
              ? conn.all<SessionRow>(`${SESSION_SELECT} ORDER BY updated_at DESC, rowid DESC`)
              : conn.all<SessionRow>(`${SESSION_SELECT} WHERE workspace_id = ? ORDER BY updated_at DESC, rowid DESC`, filter.workspaceId)
          return rows.map(toSession)
        }),
      ),
    getSession: (id) =>
      later(() =>
        conn.read(() => {
          const row = getSession(id)
          return row ? toSession(row) : undefined
        }),
      ),
    setSessionTitle: (id, title) =>
      later(() =>
        conn.write(() => {
          requireSession(id)
          conn.run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', title, conn.now(), id)
          return toSession(requireSession(id))
        }),
      ),
    setSessionModel: (id, model: SessionModel | null, thinkingLevel?: string) =>
      later(() =>
        conn.write(() => {
          requireSession(id)
          conn.run(
            'UPDATE sessions SET model_provider_id = ?, model_id = ?, thinking_level = ?, updated_at = ? WHERE id = ?',
            model?.providerId ?? null,
            model?.modelId ?? null,
            (model && thinkingLevel) || 'off',
            conn.now(),
            id,
          )
          return toSession(requireSession(id))
        }),
      ),
    appendEntries: (sessionId, entries: readonly NewSessionEntry[]) =>
      later(() =>
        conn.write(() => {
          requireSession(sessionId)
          if (entries.length === 0) return []
          const versions = checkNewEntries(payloads.payloads, entries)
          const last = conn.get<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM session_entries WHERE session_id = ?', sessionId)?.seq ?? 0
          const at = conn.now()
          const committed = entries.map((entry, i): SessionEntry => {
            const row: SessionEntry = {
              sessionId,
              seq: last + i + 1,
              kind: entry.kind,
              payloadVersion: versions[i]!,
              payload: entry.payload,
              runId: entry.runId ?? null,
              createdAt: at,
            }
            const payload = JSON.stringify(row.payload)
            conn.run(
              'INSERT INTO session_entries (session_id, seq, kind, payload_version, payload, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              sessionId,
              row.seq,
              row.kind,
              row.payloadVersion,
              payload,
              row.runId,
              at,
            )
            // 返回值与读回值一致（经过同一次 JSON 序列化），不共享调用方对象。
            return { ...row, payload: JSON.parse(payload) as JsonValue }
          })
          conn.run('UPDATE sessions SET updated_at = ? WHERE id = ?', at, sessionId)
          return committed
        }),
      ),
    listEntries: (sessionId, options) =>
      later(() =>
        conn.read(() =>
          upgradeEntries(
            conn
              .all<EntryRow>(
                'SELECT session_id, seq, kind, payload_version, payload, run_id, created_at FROM session_entries WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?',
                sessionId,
                options?.afterSeq ?? 0,
                options?.limit ?? -1,
              )
              .map(toStoredEntry),
            payloads,
          ),
        ),
      ),
  }
}

export function createSettingsRepository(conn: Connection): SettingsRepository {
  const select = (key: string) => conn.get<SettingRow>('SELECT key, value, revision, updated_at FROM settings WHERE key = ?', key)
  return {
    get: (key) =>
      later(() =>
        conn.read(() => {
          const row = select(key)
          return row ? toSetting(row) : undefined
        }),
      ),
    list: () => later(() => conn.read(() => conn.all<SettingRow>('SELECT key, value, revision, updated_at FROM settings ORDER BY key').map(toSetting))),
    set: (key, value, expectedRevision) =>
      later(() =>
        conn.write(() => {
          const actual = select(key)?.revision ?? 0
          if (actual !== expectedRevision) throw revisionConflict(key, expectedRevision, actual)
          conn.run(
            `INSERT INTO settings (key, value, revision, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, revision = excluded.revision, updated_at = excluded.updated_at`,
            key,
            JSON.stringify(value),
            actual + 1,
            conn.now(),
          )
          return toSetting(select(key) as SettingRow)
        }),
      ),
  }
}

export function createProviderRepository(conn: Connection): ProviderRepository {
  const select = (id: string) => conn.get<ProviderRow>(`${PROVIDER_SELECT} WHERE p.id = ?`, id)
  const requireProvider = (id: string): ProviderRow => {
    const row = select(id)
    if (!row) throw notFound('provider', id)
    return row
  }
  const touch = (id: string) => conn.run('UPDATE providers SET updated_at = ? WHERE id = ?', conn.now(), id)
  /** 写入或替换密文；调用方已在写事务中。 */
  const putCredential = (id: string, credential: CredentialRecord, at: number) =>
    conn.run(
      `INSERT INTO provider_credentials (provider_id, ciphertext, hint, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at`,
      id,
      credential.ciphertext,
      credential.hint,
      at,
    )

  return {
    list: () => later(() => conn.read(() => conn.all<ProviderRow>(`${PROVIDER_SELECT} ORDER BY p.created_at, p.rowid`).map(toProvider))),
    get: (id) =>
      later(() =>
        conn.read(() => {
          const row = select(id)
          return row ? toProvider(row) : undefined
        }),
      ),
    create: (input, credential) =>
      later(() =>
        conn.write(() => {
          const id = input.id
          if (select(id)) throw alreadyExists('provider', id)
          const at = conn.now()
          conn.run(
            'INSERT INTO providers (id, name, api, base_url, models, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            id,
            input.name,
            input.api,
            input.baseUrl,
            JSON.stringify(input.models),
            at,
            at,
          )
          if (credential) putCredential(id, credential, at)
          return toProvider(requireProvider(id))
        }),
      ),
    update: (id, patch, credential) =>
      later(() =>
        conn.write(() => {
          const current = toProvider(requireProvider(id))
          const next = { ...current, ...patch, id }
          const at = conn.now()
          conn.run(
            'UPDATE providers SET name = ?, api = ?, base_url = ?, models = ?, updated_at = ? WHERE id = ?',
            next.name,
            next.api,
            next.baseUrl,
            JSON.stringify(next.models),
            at,
            id,
          )
          if (credential) putCredential(id, credential, at)
          return toProvider(requireProvider(id))
        }),
      ),
    references: (id) =>
      later(() =>
        conn.read(() => {
          requireProvider(id)
          return { sessions: conn.get<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE model_provider_id = ?', id)!.n }
        }),
      ),
    delete: (id) =>
      later(() =>
        conn.write(() => {
          requireProvider(id)
          // provider_credentials 随 ON DELETE CASCADE 删除。
          conn.run('DELETE FROM providers WHERE id = ?', id)
          const sessions = conn.run("UPDATE sessions SET model_provider_id = NULL, model_id = NULL, thinking_level = 'off' WHERE model_provider_id = ?", id)
          const setting = conn.get<SettingRow>('SELECT key, value, revision, updated_at FROM settings WHERE key = ?', DEFAULT_MODEL_KEY)
          if (setting && modelPointsTo(JSON.parse(setting.value), id))
            conn.run('UPDATE settings SET value = ?, revision = ?, updated_at = ? WHERE key = ?', 'null', setting.revision + 1, conn.now(), DEFAULT_MODEL_KEY)
          return { sessions }
        }),
      ),
    setCredential: (id, credential) =>
      later(() =>
        conn.write(() => {
          requireProvider(id)
          putCredential(id, credential, conn.now())
          touch(id)
          return toProvider(requireProvider(id))
        }),
      ),
    clearCredential: (id) =>
      later(() =>
        conn.write(() => {
          requireProvider(id)
          conn.run('DELETE FROM provider_credentials WHERE provider_id = ?', id)
          touch(id)
          return toProvider(requireProvider(id))
        }),
      ),
    getCredentialCiphertext: (id) =>
      later(() =>
        conn.read(() => {
          const row = conn.get<{ ciphertext: Uint8Array }>('SELECT ciphertext FROM provider_credentials WHERE provider_id = ?', id)
          return row ? new Uint8Array(row.ciphertext) : undefined
        }),
      ),
  }
}
