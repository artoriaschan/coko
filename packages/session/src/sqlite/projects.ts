import { randomUUID } from 'node:crypto'
import type { Project, ProjectRepository } from '../types.ts'
import { alreadyExists, notFound } from '../internal.ts'
import type { Connection } from './connection.ts'

interface ProjectRow {
  id: string
  name: string
  primary_workspace_id: string
  additional_folders: string
  primary_folder_index: number
  pinned_at: number | null
  created_at: number
}
const projectOf = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  primaryWorkspaceId: row.primary_workspace_id,
  additionalFolders: JSON.parse(row.additional_folders) as string[],
  primaryFolderIndex: row.primary_folder_index,
  pinnedAt: row.pinned_at,
  createdAt: row.created_at,
})
const later = <T>(fn: () => T): Promise<T> => new Promise((resolve) => resolve(fn()))

export function createProjectRepository(conn: Connection): ProjectRepository {
  const select = (id: string) => conn.get<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)
  const requireProject = (id: string) => {
    const project = select(id)
    if (!project) throw notFound('project', id)
    return project
  }
  const checkPrimary = (workspaceId: string, except?: string) => {
    if (!conn.get('SELECT 1 FROM workspaces WHERE id = ?', workspaceId)) throw notFound('workspace', workspaceId)
    const project = conn.get<{ id: string }>('SELECT id FROM projects WHERE primary_workspace_id = ?', workspaceId)
    if (project && project.id !== except) throw alreadyExists('project workspace', workspaceId)
  }
  return {
    create: (input) =>
      later(() =>
        conn.write(() => {
          checkPrimary(input.primaryWorkspaceId)
          const id = randomUUID()
          conn.run(
            'INSERT INTO projects (id, name, primary_workspace_id, additional_folders, primary_folder_index, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            id,
            input.name,
            input.primaryWorkspaceId,
            JSON.stringify(input.additionalFolders ?? []),
            input.primaryFolderIndex ?? 0,
            conn.now(),
          )
          return projectOf(requireProject(id))
        }),
      ),
    get: (id) =>
      later(() =>
        conn.read(() => {
          const row = select(id)
          return row ? projectOf(row) : undefined
        }),
      ),
    list: () => later(() => conn.read(() => conn.all<ProjectRow>('SELECT * FROM projects ORDER BY created_at, id').map(projectOf))),
    update: (id, patch) =>
      later(() =>
        conn.write(() => {
          const current = projectOf(requireProject(id))
          if (patch.primaryWorkspaceId !== undefined) checkPrimary(patch.primaryWorkspaceId, id)
          const next = { ...current, ...patch }
          conn.run(
            'UPDATE projects SET name = ?, primary_workspace_id = ?, additional_folders = ?, primary_folder_index = ?, pinned_at = ? WHERE id = ?',
            next.name,
            next.primaryWorkspaceId,
            JSON.stringify(next.additionalFolders),
            next.primaryFolderIndex,
            next.pinnedAt,
            id,
          )
          return projectOf(requireProject(id))
        }),
      ),
    delete: (id) =>
      later(() =>
        conn.write(() => {
          requireProject(id)
          conn.run('UPDATE sessions SET project_id = NULL WHERE project_id = ?', id)
          conn.run('DELETE FROM projects WHERE id = ?', id)
        }),
      ),
  }
}
