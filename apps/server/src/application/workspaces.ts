import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { Workspace } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { AppError } from './errors.ts'

export class WorkspaceService {
  readonly #store: SessionStore

  constructor(store: SessionStore) {
    this.#store = store
  }

  list(): Promise<Workspace[]> {
    return this.#store.sessions.listWorkspaces()
  }

  /** path 必须是已存在目录的绝对路径；同一路径重复登记返回已有 Workspace。 */
  async register(input: { path: string; name?: string }): Promise<Workspace> {
    if (!isAbsolute(input.path)) throw new AppError('bad-request', 'Workspace path must be absolute')
    const path = resolve(input.path)
    const info = await stat(path).catch(() => undefined)
    if (!info?.isDirectory()) throw new AppError('bad-request', `Not a directory: ${path}`)
    return this.#store.sessions.registerWorkspace({ path, ...(input.name ? { name: input.name } : {}) })
  }
}
