// 内存实现：语义与 SQLite 实现一致（同一组契约测试），用于单元测试；不持久化。
import { randomUUID } from 'node:crypto'
import {
  alreadyExists,
  checkHostProcess,
  checkMemoryScope,
  checkScheduleStatus,
  checkWorktreeCreator,
  closedError,
  defaultWorkspaceName,
  levelOf,
  notFound,
  recordRevisionConflict,
  revisionConflict,
  sameWorkspace,
  upgradeEntries,
} from '../internal.ts'
import { checkNewEntries } from '../payloads.ts'
import type {
  CredentialRecord,
  HostProcess,
  HostProcessInput,
  JsonValue,
  Memory,
  MemoryInput,
  MemoryScope,
  NewSchedule,
  NewSession,
  NewSessionEntry,
  NewWorktree,
  Provider,
  ProviderInput,
  ScheduleFire,
  SchedulePatch,
  ScheduleRecord,
  SecretInfo,
  Session,
  SessionEntry,
  SessionStore,
  Setting,
  SessionModelChoice,
  WorktreeRecord,
  SettingRewrite,
  StoreOptions,
  Workspace,
} from '../types.ts'

interface ProviderRow {
  provider: Omit<Provider, 'credential'>
  credential: CredentialRecord | null
}

export function createMemoryStore(options: StoreOptions): SessionStore {
  const now = options.now ?? Date.now
  let closed = false
  const workspaces = new Map<string, Workspace>()
  const sessions = new Map<string, Session>()
  const entries = new Map<string, SessionEntry[]>()
  const settings = new Map<string, Setting>()
  const providers = new Map<string, ProviderRow>()
  /** 插入顺序即 rowid 顺序（与 SQLite 的同时间戳排序一致）。 */
  const memories = new Map<string, Memory>()
  const secrets = new Map<string, SecretInfo & { ciphertext: Uint8Array }>()
  /** 插入顺序即登记顺序。 */
  const processes = new Map<string, HostProcess>()
  /** 插入顺序即创建顺序。 */
  const worktrees = new Map<string, WorktreeRecord>()
  const schedules = new Map<string, ScheduleRecord>()

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
  const requireSchedule = (id: string): ScheduleRecord => {
    const schedule = schedules.get(id)
    if (!schedule) throw notFound('schedule', id)
    return schedule
  }
  /** 校验并生成待追加的条目，不修改状态（与 SQLite 的事务一致：先完成全部检查再写入）。 */
  const prepareEntries = (sessionId: string, input: readonly NewSessionEntry[]) => {
    const session = requireSession(sessionId)
    const versions = input.length === 0 ? [] : checkNewEntries(options.payloads, input)
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
    return {
      added,
      commit: () => {
        if (added.length === 0) return
        list.push(...added)
        entries.set(sessionId, list)
        session.updatedAt = at
      },
    }
  }
  const requireProvider = (id: string): ProviderRow => {
    const row = providers.get(id)
    if (!row) throw notFound('provider', id)
    return row
  }
  const copyCredential = (credential: CredentialRecord): CredentialRecord => ({ ciphertext: new Uint8Array(credential.ciphertext), hint: credential.hint })
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
      createSession: op((input: NewSession) => {
        if (!workspaces.has(input.workspaceId)) throw notFound('workspace', input.workspaceId)
        const parentSessionId = input.parentSessionId ?? null
        const worktreeId = input.worktreeId ?? null
        if (parentSessionId !== null) sameWorkspace('parentSessionId', requireSession(parentSessionId).workspaceId, input.workspaceId)
        if (worktreeId !== null) {
          const worktree = worktrees.get(worktreeId)
          if (!worktree) throw notFound('worktree', worktreeId)
          sameWorkspace('worktreeId', worktree.workspaceId, input.workspaceId)
        }
        const at = now()
        const session: Session = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          title: input.title ?? '',
          model: input.model ?? null,
          thinkingLevel: levelOf(input),
          modelCleared: false,
          parentSessionId,
          worktreeId,
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
          .filter(({ session }) => session.parentSessionId === null && (filter?.workspaceId === undefined || session.workspaceId === filter.workspaceId))
          .sort((a, b) => b.session.updatedAt - a.session.updatedAt || b.index - a.index)
          .map(({ session }) => session),
      ),
      listChildren: op((parentSessionId: string) => [...sessions.values()].filter((session) => session.parentSessionId === parentSessionId)),
      getSession: op((id: string) => sessions.get(id)),
      setSessionTitle: op((id: string, title: string) => touch(requireSession(id), { title })),
      setSessionModel: op((id: string, choice: SessionModelChoice) =>
        touch(requireSession(id), { model: copy(choice.model), thinkingLevel: levelOf(choice), modelCleared: false }),
      ),
      appendEntries: op((sessionId: string, input: readonly NewSessionEntry[]) => {
        const { added, commit } = prepareEntries(sessionId, input)
        commit()
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
      create: op((input: ProviderInput, credential?: CredentialRecord) => {
        if (providers.has(input.id)) throw alreadyExists('provider', input.id)
        const at = now()
        const row: ProviderRow = { provider: { ...copy(input), createdAt: at, updatedAt: at }, credential: credential ? copyCredential(credential) : null }
        providers.set(row.provider.id, row)
        return toProvider(row)
      }),
      update: op((id: string, patch: Partial<Omit<ProviderInput, 'id'>>, credential?: CredentialRecord) => {
        const row = requireProvider(id)
        Object.assign(row.provider, copy(patch), { id, updatedAt: now() })
        if (credential) row.credential = copyCredential(credential)
        return toProvider(row)
      }),
      references: op((id: string) => {
        requireProvider(id)
        return { sessions: [...sessions.values()].filter((s) => s.model?.providerId === id).length }
      }),
      delete: op((id: string, options?: { settings?: readonly SettingRewrite[] }) => {
        requireProvider(id)
        // 与 SQLite 的事务一致：先求出全部改写（条件可能抛出），再修改状态。
        const rewrites = (options?.settings ?? []).filter((rewrite) => {
          const current = settings.get(rewrite.key)
          return current !== undefined && rewrite.when(copy(current.value))
        })
        providers.delete(id)
        let cleared = 0
        for (const session of sessions.values()) {
          if (session.model?.providerId !== id) continue
          Object.assign(session, { model: null, thinkingLevel: 'off', modelCleared: true })
          cleared++
        }
        for (const rewrite of rewrites) {
          const current = settings.get(rewrite.key)!
          settings.set(rewrite.key, { key: rewrite.key, value: copy(rewrite.value), revision: current.revision + 1, updatedAt: now() })
        }
        return { sessions: cleared, settings: rewrites.map((r) => r.key) }
      }),
      setCredential: op((id: string, credential: CredentialRecord) => {
        const row = requireProvider(id)
        row.credential = copyCredential(credential)
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
    memories: {
      list: op((filter: { scope?: MemoryScope; workspaceId?: string } = {}) =>
        [...memories.values()]
          .map((memory, index) => ({ memory, index }))
          .filter(
            ({ memory }) =>
              (filter.scope === undefined || memory.scope === filter.scope) && (filter.workspaceId === undefined || memory.workspaceId === filter.workspaceId),
          )
          .sort((a, b) => b.memory.updatedAt - a.memory.updatedAt || b.index - a.index)
          .map(({ memory }) => memory),
      ),
      get: op((id: string) => memories.get(id)),
      create: op((input: MemoryInput) => {
        const workspaceId = checkMemoryScope(input)
        if (workspaceId !== null && !workspaces.has(workspaceId)) throw notFound('workspace', workspaceId)
        const at = now()
        const memory: Memory = { id: randomUUID(), scope: input.scope, workspaceId, content: input.content, source: input.source, createdAt: at, updatedAt: at }
        memories.set(memory.id, memory)
        return memory
      }),
      update: op((id: string, patch: { content: string }) => {
        const memory = memories.get(id)
        if (!memory) throw notFound('memory', id)
        Object.assign(memory, { content: patch.content, updatedAt: now() })
        return memory
      }),
      delete: op((id: string) => {
        if (!memories.delete(id)) throw notFound('memory', id)
      }),
    },
    secrets: {
      list: op(() =>
        [...secrets.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(({ name, hint, updatedAt }) => ({ name, hint, updatedAt })),
      ),
      setCiphertext: op((name: string, secret: { ciphertext: Uint8Array; hint: string }) => {
        const row = { name, hint: secret.hint, updatedAt: now(), ciphertext: new Uint8Array(secret.ciphertext) }
        secrets.set(name, row)
        return { name, hint: row.hint, updatedAt: row.updatedAt }
      }),
      getCiphertext: op((name: string) => {
        const ciphertext = secrets.get(name)?.ciphertext
        return ciphertext ? new Uint8Array(ciphertext) : undefined
      }),
      delete: op((name: string) => {
        if (!secrets.delete(name)) throw notFound('secret', name)
      }),
    },
    processes: {
      register: op((input: HostProcessInput) => {
        const { pgid, sessionId, jobId } = checkHostProcess(input)
        if (processes.has(input.id)) throw alreadyExists('process', input.id)
        const process: HostProcess = {
          id: input.id,
          pid: input.pid,
          pgid,
          startedAt: input.startedAt,
          kind: input.kind,
          sessionId,
          jobId,
          command: input.command,
          createdAt: now(),
        }
        processes.set(process.id, process)
        return process
      }),
      remove: op((id: string) => {
        processes.delete(id)
      }),
      list: op(() => [...processes.values()].sort((a, b) => a.createdAt - b.createdAt)),
    },
    worktrees: {
      create: op((input: NewWorktree) => {
        if (!workspaces.has(input.workspaceId)) throw notFound('workspace', input.workspaceId)
        checkWorktreeCreator(input.createdBy)
        for (const existing of worktrees.values()) if (existing.path === input.path) throw alreadyExists('worktree', input.path)
        const worktree: WorktreeRecord = { id: randomUUID(), ...copy(input), status: 'active', createdAt: now(), removedAt: null }
        worktrees.set(worktree.id, worktree)
        return worktree
      }),
      get: op((id: string) => worktrees.get(id)),
      list: op((workspaceId: string) => [...worktrees.values()].filter((w) => w.workspaceId === workspaceId)),
      markRemoved: op((id: string) => {
        const worktree = worktrees.get(id)
        if (!worktree) throw notFound('worktree', id)
        if (worktree.status !== 'removed') Object.assign(worktree, { status: 'removed', removedAt: now() })
        return worktree
      }),
    },
    schedules: {
      create: op((input: NewSchedule) => {
        requireSession(input.sessionId)
        const status = input.status ?? 'active'
        checkScheduleStatus(status)
        const at = now()
        const schedule: ScheduleRecord = {
          id: randomUUID(),
          sessionId: input.sessionId,
          title: input.title,
          prompt: input.prompt,
          rule: copy(input.rule),
          status,
          nextAt: input.nextAt,
          lastOccurrence: null,
          revision: 1,
          createdAt: at,
          updatedAt: at,
        }
        schedules.set(schedule.id, schedule)
        return schedule
      }),
      update: op((id: string, revision: number, patch: SchedulePatch) => {
        const schedule = requireSchedule(id)
        if (schedule.revision !== revision) throw recordRevisionConflict('schedule', id, revision, schedule.revision)
        if (patch.status !== undefined) checkScheduleStatus(patch.status)
        const defined = Object.fromEntries(Object.entries(copy(patch)).filter(([, value]) => value !== undefined))
        Object.assign(schedule, defined, { revision: schedule.revision + 1, updatedAt: now() })
        return schedule
      }),
      delete: op((id: string) => {
        if (!schedules.delete(id)) throw notFound('schedule', id)
      }),
      list: op((filter: { sessionId?: string } = {}) =>
        [...schedules.values()].filter((s) => filter.sessionId === undefined || s.sessionId === filter.sessionId),
      ),
      due: op((at: number) =>
        [...schedules.values()]
          .map((schedule, index) => ({ schedule, index }))
          .filter(({ schedule }) => schedule.status === 'active' && schedule.nextAt !== null && schedule.nextAt <= at)
          .sort((a, b) => a.schedule.nextAt! - b.schedule.nextAt! || a.index - b.index)
          .map(({ schedule }) => schedule),
      ),
      recordFire: op((id: string, fire: ScheduleFire, entry: NewSessionEntry) => {
        const schedule = requireSchedule(id)
        if (fire.status !== undefined) checkScheduleStatus(fire.status)
        // 先完成全部检查（条目校验可能抛出），再同时修改任务与条目。
        const { added, commit } = prepareEntries(schedule.sessionId, [entry])
        commit()
        Object.assign(schedule, {
          lastOccurrence: fire.occurrence,
          nextAt: fire.nextAt,
          ...(fire.status !== undefined ? { status: fire.status } : {}),
          updatedAt: now(),
        })
        return { schedule, entry: added[0]! }
      }),
    },
    async close() {
      closed = true
    },
  }
}
