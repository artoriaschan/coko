import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

/**
 * Resolve a model-supplied path against the Workspace directory.
 * Accepts absolute paths, `~`, and a leading `@` (models copy file mentions verbatim).
 * M1 does not confine paths to the Workspace; that is part of M2 permissions.
 */
export function resolveToCwd(filePath: string, cwd: string): string {
  let path = filePath.replace(UNICODE_SPACES, ' ')
  if (path.startsWith('@')) path = path.slice(1)
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2))
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path)
}

export function abortError(): Error {
  return new Error('Operation aborted')
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError()
}
