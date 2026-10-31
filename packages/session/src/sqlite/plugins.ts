// 已安装插件的 SQLite 仓库（迁移 v9；ADR 0017）。
import { StoreError } from '../errors.ts'
import { checkPluginSourceKind, notFound } from '../internal.ts'
import type { PluginInput, PluginRecord, PluginRepository, PluginSourceKind } from '../types.ts'
import type { Connection } from './connection.ts'

const later = <T>(fn: () => T): Promise<T> => new Promise((resolve) => resolve(fn()))

interface PluginRow {
  name: string
  version: string
  source_kind: PluginSourceKind
  source_location: string
  source_ref: string | null
  commit: string | null
  path: string
  digest: string
  approved_digest: string | null
  enabled: number
  installed_at: number
  updated_at: number
}

const toPlugin = (r: PluginRow): PluginRecord => ({
  name: r.name,
  version: r.version,
  sourceKind: r.source_kind,
  sourceLocation: r.source_location,
  sourceRef: r.source_ref,
  commit: r.commit,
  path: r.path,
  digest: r.digest,
  approvedDigest: r.approved_digest,
  enabled: r.enabled === 1,
  installedAt: r.installed_at,
  updatedAt: r.updated_at,
})

export function createPluginRepository(conn: Connection): PluginRepository {
  const select = (name: string) => conn.get<PluginRow>('SELECT * FROM plugins WHERE name = ?', name)
  const requirePlugin = (name: string): PluginRow => {
    const row = select(name)
    if (!row) throw notFound('plugin', name)
    return row
  }
  return {
    list: () => later(() => conn.read(() => conn.all<PluginRow>('SELECT * FROM plugins ORDER BY name').map(toPlugin))),
    get: (name) =>
      later(() =>
        conn.read(() => {
          const row = select(name)
          return row ? toPlugin(row) : undefined
        }),
      ),
    upsert: (input: PluginInput) =>
      later(() =>
        conn.write(() => {
          checkPluginSourceKind(input.sourceKind)
          const owner = conn.get<{ name: string }>('SELECT name FROM plugins WHERE path = ?', input.path)
          if (owner && owner.name !== input.name)
            throw new StoreError('already-exists', `plugin path ${input.path} is used by ${owner.name}`, { entity: 'plugin-path', id: input.path })
          const at = conn.now()
          const fields = [input.version, input.sourceKind, input.sourceLocation, input.sourceRef ?? null, input.commit ?? null, input.path, input.digest]
          if (select(input.name))
            conn.run(
              `UPDATE plugins SET version = ?, source_kind = ?, source_location = ?, source_ref = ?, "commit" = ?, path = ?, digest = ?, updated_at = ?
               WHERE name = ?`,
              ...fields,
              at,
              input.name,
            )
          else
            conn.run(
              `INSERT INTO plugins (name, version, source_kind, source_location, source_ref, "commit", path, digest, approved_digest, enabled, installed_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
              input.name,
              ...fields,
              at,
              at,
            )
          return toPlugin(requirePlugin(input.name))
        }),
      ),
    approve: (name, digest) =>
      later(() =>
        conn.write(() => {
          requirePlugin(name)
          conn.run('UPDATE plugins SET approved_digest = ?, enabled = 1, updated_at = ? WHERE name = ?', digest, conn.now(), name)
          return toPlugin(requirePlugin(name))
        }),
      ),
    setEnabled: (name, enabled) =>
      later(() =>
        conn.write(() => {
          requirePlugin(name)
          conn.run('UPDATE plugins SET enabled = ?, updated_at = ? WHERE name = ?', enabled ? 1 : 0, conn.now(), name)
          return toPlugin(requirePlugin(name))
        }),
      ),
    delete: (name) =>
      later(() =>
        conn.write(() => {
          requirePlugin(name)
          conn.run('DELETE FROM plugins WHERE name = ?', name)
        }),
      ),
  }
}
