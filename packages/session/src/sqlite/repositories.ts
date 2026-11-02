// SessionStore 的 SQLite 实现：每个写入方法一个 BEGIN IMMEDIATE 事务。
import { randomUUID } from 'node:crypto'
import { StoreError } from '../errors.ts'
import {
  alreadyExists,
  checkScheduleStatus,
  checkWorktreeCreator,
  defaultWorkspaceName,
  levelOf,
  notFound,
  parseLevel,
  recordRevisionConflict,
  revisionConflict,
  sameWorkspace,
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
  ScheduleRecord,
  ScheduleRepository,
  ScheduleStatus,
  Session,
  SessionEntry,
  SessionRepository,
  Setting,
  SettingsRepository,
  StoreOptions,
  Workspace,
  WorktreeCreator,
  WorktreeRecord,
  WorktreeRepository,
  WorktreeStatus,
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
  model_cleared: number
  parent_session_id: string | null
  worktree_id: string | null
  project_id: string | null
  pinned_at: number | null
  archived_at: number | null
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
  thinkingLevel: parseLevel(r.thinking_level),
  modelCleared: r.model_cleared === 1,
  parentSessionId: r.parent_session_id,
  worktreeId: r.worktree_id,
  projectId: r.project_id,
  pinnedAt: r.pinned_at,
  archivedAt: r.archived_at,
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

const SESSION_SELECT =
  'SELECT id, workspace_id, title, model_provider_id, model_id, thinking_level, model_cleared, parent_session_id, worktree_id, project_id, pinned_at, archived_at, created_at, updated_at FROM sessions'
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
          const parentSessionId = input.parentSessionId ?? null
          const worktreeId = input.worktreeId ?? null
          if (parentSessionId !== null) sameWorkspace('parentSessionId', requireSession(parentSessionId).workspace_id, input.workspaceId)
          if (worktreeId !== null) {
            const worktree = conn.get<{ workspace_id: string }>('SELECT workspace_id FROM worktrees WHERE id = ?', worktreeId)
            if (!worktree) throw notFound('worktree', worktreeId)
            sameWorkspace('worktreeId', worktree.workspace_id, input.workspaceId)
          }
          const projectId =
            parentSessionId !== null
              ? null
              : input.projectId === undefined
                ? (conn.get<{ id: string }>('SELECT id FROM projects WHERE primary_workspace_id = ?', input.workspaceId)?.id ?? null)
                : input.projectId
          if (projectId !== null && !conn.get('SELECT 1 FROM projects WHERE id = ?', projectId)) throw notFound('project', projectId)
          const at = conn.now()
          const model = input.model ?? null
          const id = input.id ?? randomUUID()
          if (getSession(id)) throw alreadyExists('session', id)
          conn.run(
            `INSERT INTO sessions (id, workspace_id, title, model_provider_id, model_id, thinking_level, parent_session_id, worktree_id, project_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            input.workspaceId,
            input.title ?? '',
            model?.providerId ?? null,
            model?.modelId ?? null,
            levelOf(input),
            parentSessionId,
            worktreeId,
            projectId,
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
              ? conn.all<SessionRow>(`${SESSION_SELECT} WHERE parent_session_id IS NULL ORDER BY updated_at DESC, id`)
              : conn.all<SessionRow>(`${SESSION_SELECT} WHERE parent_session_id IS NULL AND workspace_id = ? ORDER BY updated_at DESC, id`, filter.workspaceId)
          return rows.map(toSession)
        }),
      ),
    listChildren: (parentSessionId) =>
      later(() =>
        conn.read(() => conn.all<SessionRow>(`${SESSION_SELECT} WHERE parent_session_id = ? ORDER BY created_at, rowid`, parentSessionId).map(toSession)),
      ),
    getSession: (id) =>
      later(() =>
        conn.read(() => {
          const row = getSession(id)
          return row ? toSession(row) : undefined
        }),
      ),
    setSessionArchived: (id, archivedAt) =>
      later(() =>
        conn.write(() => {
          requireSession(id)
          conn.run(
            'WITH RECURSIVE tree(id) AS (SELECT id FROM sessions WHERE id = ? UNION ALL SELECT s.id FROM sessions s JOIN tree t ON s.parent_session_id = t.id) UPDATE sessions SET archived_at = ?, pinned_at = NULL WHERE id IN (SELECT id FROM tree)',
            id,
            archivedAt,
          )
          return toSession(requireSession(id))
        }),
      ),
    setSessionOrganization: (id, patch) =>
      later(() =>
        conn.write(() => {
          const current = requireSession(id)
          if (patch.projectId != null && !conn.get('SELECT 1 FROM projects WHERE id = ?', patch.projectId)) throw notFound('project', patch.projectId)
          if (current.parent_session_id !== null && patch.projectId != null)
            throw new StoreError('invalid-input', 'Only root sessions store project membership')
          conn.run(
            'UPDATE sessions SET project_id = ?, pinned_at = ?, archived_at = ? WHERE id = ?',
            patch.projectId === undefined ? current.project_id : patch.projectId,
            patch.pinnedAt === undefined ? current.pinned_at : patch.pinnedAt,
            patch.archivedAt === undefined ? current.archived_at : patch.archivedAt,
            id,
          )
          return toSession(requireSession(id))
        }),
      ),
    deleteSession: (id) =>
      later(() =>
        conn.write(() => {
          requireSession(id)
          const rows = conn.all<{ id: string }>(
            'WITH RECURSIVE tree(id) AS (SELECT id FROM sessions WHERE id = ? UNION ALL SELECT s.id FROM sessions s JOIN tree t ON s.parent_session_id = t.id) SELECT id FROM tree',
            id,
          )
          for (const row of rows) {
            conn.run('DELETE FROM session_entries WHERE session_id = ?', row.id)
            conn.run('DELETE FROM schedules WHERE session_id = ?', row.id)
            conn.run('DELETE FROM host_processes WHERE session_id = ?', row.id)
          }
          for (const row of rows.reverse()) conn.run('DELETE FROM sessions WHERE id = ?', row.id)
          return rows.map((row) => row.id)
        }),
      ),
    deleteWorkspaceIfUnused: (id) =>
      later(() =>
        conn.write(() => {
          for (const [table, column] of [
            ['sessions', 'workspace_id'],
            ['projects', 'primary_workspace_id'],
            ['worktrees', 'workspace_id'],
            ['memories', 'workspace_id'],
          ]) {
            if (conn.get(`SELECT 1 FROM ${table} WHERE ${column} = ?`, id)) return false
          }
          return conn.run('DELETE FROM workspaces WHERE id = ?', id) > 0
        }),
      ),
    replaceSessionTitle: (id, expected, title) =>
      later(() =>
        conn.write(() => {
          if (!conn.run('UPDATE sessions SET title = ? WHERE id = ? AND title = ?', title, id, expected)) return undefined
          return toSession(requireSession(id))
        }),
      ),
    setSessionTitle: (id, title) =>
      later(() =>
        conn.write(() => {
          requireSession(id)
          conn.run('UPDATE sessions SET title = ? WHERE id = ?', title, id)
          return toSession(requireSession(id))
        }),
      ),
    setSessionModel: (id, choice) =>
      later(() =>
        conn.write(() => {
          requireSession(id)
          conn.run(
            'UPDATE sessions SET model_provider_id = ?, model_id = ?, thinking_level = ?, model_cleared = 0 WHERE id = ?',
            choice.model?.providerId ?? null,
            choice.model?.modelId ?? null,
            levelOf(choice),
            id,
          )
          return toSession(requireSession(id))
        }),
      ),
    appendEntries: (sessionId, entries: readonly NewSessionEntry[]) => later(() => conn.write(() => appendInTransaction(conn, payloads, sessionId, entries))),
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
    delete: (id, options) =>
      later(() =>
        conn.write(() => {
          requireProvider(id)
          // provider_credentials 随 ON DELETE CASCADE 删除。
          conn.run('DELETE FROM providers WHERE id = ?', id)
          const sessions = conn.run(
            "UPDATE sessions SET model_provider_id = NULL, model_id = NULL, thinking_level = 'off', model_cleared = 1 WHERE model_provider_id = ?",
            id,
          )
          // 设置的改写由调用方给出；条件在本事务中求值，抛出时整个删除回滚。
          const rewritten: string[] = []
          for (const rewrite of options?.settings ?? []) {
            const row = conn.get<SettingRow>('SELECT key, value, revision, updated_at FROM settings WHERE key = ?', rewrite.key)
            if (!row || !rewrite.when(JSON.parse(row.value) as JsonValue)) continue
            conn.run(
              'UPDATE settings SET value = ?, revision = ?, updated_at = ? WHERE key = ?',
              JSON.stringify(rewrite.value),
              row.revision + 1,
              conn.now(),
              rewrite.key,
            )
            rewritten.push(rewrite.key)
          }
          return { sessions, settings: rewritten }
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
/** 在调用方的写事务中追加条目（Session 不存在 not-found、不合 schema invalid-payload，均抛出以回滚整个事务）。 */
function appendInTransaction(
  conn: Connection,
  payloads: Pick<StoreOptions, 'payloads'>,
  sessionId: string,
  entries: readonly NewSessionEntry[],
): SessionEntry[] {
  if (!conn.get('SELECT 1 FROM sessions WHERE id = ?', sessionId)) throw notFound('session', sessionId)
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
}

interface WorktreeRow {
  id: string
  workspace_id: string
  name: string
  path: string
  branch: string
  base_commit: string
  repo_root: string
  status: WorktreeStatus
  created_by: WorktreeCreator
  created_at: number
  removed_at: number | null
}

const toWorktree = (r: WorktreeRow): WorktreeRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  path: r.path,
  branch: r.branch,
  baseCommit: r.base_commit,
  repoRoot: r.repo_root,
  status: r.status,
  createdBy: r.created_by,
  createdAt: r.created_at,
  removedAt: r.removed_at,
})

export function createWorktreeRepository(conn: Connection): WorktreeRepository {
  const select = (id: string) => conn.get<WorktreeRow>('SELECT * FROM worktrees WHERE id = ?', id)
  return {
    create: (input) =>
      later(() =>
        conn.write(() => {
          if (!conn.get('SELECT 1 FROM workspaces WHERE id = ?', input.workspaceId)) throw notFound('workspace', input.workspaceId)
          checkWorktreeCreator(input.createdBy)
          if (conn.get('SELECT 1 FROM worktrees WHERE path = ?', input.path)) throw alreadyExists('worktree', input.path)
          const id = randomUUID()
          conn.run(
            `INSERT INTO worktrees (id, workspace_id, name, path, branch, base_commit, repo_root, status, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
            id,
            input.workspaceId,
            input.name,
            input.path,
            input.branch,
            input.baseCommit,
            input.repoRoot,
            input.createdBy,
            conn.now(),
          )
          return toWorktree(select(id)!)
        }),
      ),
    get: (id) =>
      later(() =>
        conn.read(() => {
          const row = select(id)
          return row ? toWorktree(row) : undefined
        }),
      ),
    list: (workspaceId) =>
      later(() =>
        conn.read(() => conn.all<WorktreeRow>('SELECT * FROM worktrees WHERE workspace_id = ? ORDER BY created_at, rowid', workspaceId).map(toWorktree)),
      ),
    markRemoved: (id) =>
      later(() =>
        conn.write(() => {
          const row = select(id)
          if (!row) throw notFound('worktree', id)
          if (row.status !== 'removed') conn.run("UPDATE worktrees SET status = 'removed', removed_at = ? WHERE id = ?", conn.now(), id)
          return toWorktree(select(id)!)
        }),
      ),
  }
}

interface ScheduleRow {
  id: string
  session_id: string
  title: string
  prompt: string
  rule: string
  status: ScheduleStatus
  next_at: number | null
  last_occurrence: number | null
  revision: number
  created_at: number
  updated_at: number
}

const toSchedule = (r: ScheduleRow): ScheduleRecord => ({
  id: r.id,
  sessionId: r.session_id,
  title: r.title,
  prompt: r.prompt,
  rule: JSON.parse(r.rule) as JsonValue,
  status: r.status,
  nextAt: r.next_at,
  lastOccurrence: r.last_occurrence,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function createScheduleRepository(conn: Connection, payloads: Pick<StoreOptions, 'payloads'>): ScheduleRepository {
  const select = (id: string) => conn.get<ScheduleRow>('SELECT * FROM schedules WHERE id = ?', id)
  const requireSchedule = (id: string): ScheduleRow => {
    const row = select(id)
    if (!row) throw notFound('schedule', id)
    return row
  }
  return {
    create: (input) =>
      later(() =>
        conn.write(() => {
          if (!conn.get('SELECT 1 FROM sessions WHERE id = ?', input.sessionId)) throw notFound('session', input.sessionId)
          const status = input.status ?? 'active'
          checkScheduleStatus(status)
          const id = randomUUID()
          const at = conn.now()
          conn.run(
            `INSERT INTO schedules (id, session_id, title, prompt, rule, status, next_at, last_occurrence, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
            id,
            input.sessionId,
            input.title,
            input.prompt,
            JSON.stringify(input.rule),
            status,
            input.nextAt,
            at,
            at,
          )
          return toSchedule(select(id)!)
        }),
      ),
    get: (id) =>
      later(() => {
        const row = select(id)
        return row ? toSchedule(row) : undefined
      }),
    update: (id, revision, patch) =>
      later(() =>
        conn.write(() => {
          const current = toSchedule(requireSchedule(id))
          if (current.revision !== revision) throw recordRevisionConflict('schedule', id, revision, current.revision)
          if (patch.status !== undefined) checkScheduleStatus(patch.status)
          const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
          const next = { ...current, ...defined }
          conn.run(
            'UPDATE schedules SET title = ?, prompt = ?, rule = ?, status = ?, next_at = ?, revision = ?, updated_at = ? WHERE id = ?',
            next.title,
            next.prompt,
            JSON.stringify(next.rule),
            next.status,
            next.nextAt,
            current.revision + 1,
            conn.now(),
            id,
          )
          return toSchedule(select(id)!)
        }),
      ),
    delete: (id) =>
      later(() =>
        conn.write(() => {
          requireSchedule(id)
          conn.run('DELETE FROM schedules WHERE id = ?', id)
        }),
      ),
    list: (filter) =>
      later(() =>
        conn.read(() =>
          (filter?.sessionId === undefined
            ? conn.all<ScheduleRow>('SELECT * FROM schedules ORDER BY created_at, rowid')
            : conn.all<ScheduleRow>('SELECT * FROM schedules WHERE session_id = ? ORDER BY created_at, rowid', filter.sessionId)
          ).map(toSchedule),
        ),
      ),
    due: (now) =>
      later(() =>
        conn.read(() =>
          conn
            .all<ScheduleRow>("SELECT * FROM schedules WHERE status = 'active' AND next_at IS NOT NULL AND next_at <= ? ORDER BY next_at, rowid", now)
            .map(toSchedule),
        ),
      ),
    recordFire: (id, fire, entry) =>
      later(() =>
        conn.write(() => {
          const current = requireSchedule(id)
          if (fire.status !== undefined) checkScheduleStatus(fire.status)
          // 先改任务行、后追加条目：条目校验或写入失败时整个事务回滚，两者都不变。
          conn.run(
            'UPDATE schedules SET last_occurrence = ?, next_at = ?, status = ?, updated_at = ? WHERE id = ?',
            fire.occurrence,
            fire.nextAt,
            fire.status ?? current.status,
            conn.now(),
            id,
          )
          const [committed] = appendInTransaction(conn, payloads, current.session_id, [entry])
          return { schedule: toSchedule(select(id)!), entry: committed! }
        }),
      ),
  }
}
