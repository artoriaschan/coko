// Memory 与登记的 Secret 的 SQLite 仓库（迁移 v3；ADR 0003、0007）。
import { randomUUID } from 'node:crypto'
import { checkMemoryScope, notFound } from '../internal.ts'
import type { Memory, MemoryInput, MemoryRepository, MemoryScope, SecretInfo, SecretRepository } from '../types.ts'
import type { Connection } from './connection.ts'

const later = <T>(fn: () => T): Promise<T> => new Promise((resolve) => resolve(fn()))

interface MemoryRow {
  id: string
  scope: MemoryScope
  workspace_id: string | null
  content: string
  source: string
  created_at: number
  updated_at: number
}

const toMemory = (r: MemoryRow): Memory => ({
  id: r.id,
  scope: r.scope,
  workspaceId: r.workspace_id,
  content: r.content,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

export function createMemoryRepository(conn: Connection): MemoryRepository {
  const select = (id: string) => conn.get<MemoryRow>('SELECT * FROM memories WHERE id = ?', id)
  const requireMemory = (id: string): MemoryRow => {
    const row = select(id)
    if (!row) throw notFound('memory', id)
    return row
  }
  return {
    list: (filter = {}) =>
      later(() =>
        conn.read(() =>
          conn
            .all<MemoryRow>(
              `SELECT * FROM memories WHERE (?1 IS NULL OR scope = ?1) AND (?2 IS NULL OR workspace_id = ?2)
               ORDER BY updated_at DESC, rowid DESC`,
              filter.scope ?? null,
              filter.workspaceId ?? null,
            )
            .map(toMemory),
        ),
      ),
    get: (id) =>
      later(() =>
        conn.read(() => {
          const row = select(id)
          return row ? toMemory(row) : undefined
        }),
      ),
    create: (input: MemoryInput) =>
      later(() =>
        conn.write(() => {
          const workspaceId = checkMemoryScope(input)
          if (workspaceId !== null && !conn.get('SELECT 1 FROM workspaces WHERE id = ?', workspaceId)) throw notFound('workspace', workspaceId)
          const id = randomUUID()
          const at = conn.now()
          conn.run(
            'INSERT INTO memories (id, scope, workspace_id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            id,
            input.scope,
            workspaceId,
            input.content,
            input.source,
            at,
            at,
          )
          return toMemory(requireMemory(id))
        }),
      ),
    update: (id, patch) =>
      later(() =>
        conn.write(() => {
          requireMemory(id)
          conn.run('UPDATE memories SET content = ?, updated_at = ? WHERE id = ?', patch.content, conn.now(), id)
          return toMemory(requireMemory(id))
        }),
      ),
    delete: (id) =>
      later(() =>
        conn.write(() => {
          requireMemory(id)
          conn.run('DELETE FROM memories WHERE id = ?', id)
        }),
      ),
  }
}

interface SecretRow {
  name: string
  hint: string
  updated_at: number
}

const toSecret = (r: SecretRow): SecretInfo => ({ name: r.name, hint: r.hint, updatedAt: r.updated_at })

export function createSecretRepository(conn: Connection): SecretRepository {
  const select = (name: string) => conn.get<SecretRow>('SELECT name, hint, updated_at FROM secrets WHERE name = ?', name)
  return {
    list: () => later(() => conn.read(() => conn.all<SecretRow>('SELECT name, hint, updated_at FROM secrets ORDER BY name').map(toSecret))),
    setCiphertext: (name, secret) =>
      later(() =>
        conn.write(() => {
          conn.run(
            `INSERT INTO secrets (name, ciphertext, hint, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at`,
            name,
            secret.ciphertext,
            secret.hint,
            conn.now(),
          )
          return toSecret(select(name)!)
        }),
      ),
    getCiphertext: (name) =>
      later(() =>
        conn.read(() => {
          const row = conn.get<{ ciphertext: Uint8Array }>('SELECT ciphertext FROM secrets WHERE name = ?', name)
          return row ? new Uint8Array(row.ciphertext) : undefined
        }),
      ),
    delete: (name) =>
      later(() =>
        conn.write(() => {
          if (!select(name)) throw notFound('secret', name)
          conn.run('DELETE FROM secrets WHERE name = ?', name)
        }),
      ),
  }
}
