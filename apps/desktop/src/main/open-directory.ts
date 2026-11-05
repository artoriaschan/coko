import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** Narrow host boundary: only an existing local directory reaches the injected shell. */
export async function openDirectory(path: unknown, shell: { openPath(path: string): Promise<string> }): Promise<boolean> {
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  try {
    if (!(await stat(path)).isDirectory()) return false
    return (await shell.openPath(path)) === ''
  } catch {
    return false
  }
}

/** Files use the same narrow shell boundary as folders. */
export async function openFile(path: unknown, shell: { openPath(path: string): Promise<string> }): Promise<boolean> {
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  try {
    if (!(await stat(path)).isFile()) return false
    return (await shell.openPath(path)) === ''
  } catch {
    return false
  }
}
