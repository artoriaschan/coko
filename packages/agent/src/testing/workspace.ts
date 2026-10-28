import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface TempWorkspace {
  /** Real path of the directory (macOS resolves /var to /private/var). */
  readonly dir: string
  path(relative: string): string
  write(relative: string, content: string | Uint8Array): Promise<string>
  dispose(): Promise<void>
}

/** A fresh `mkdtemp` directory. Register `dispose` in teardown right after creating it. */
export async function createTempWorkspace(prefix = 'coko-agent-'): Promise<TempWorkspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  return {
    dir,
    path: (relative) => join(dir, relative),
    async write(relative, content) {
      const target = join(dir, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
      return target
    },
    dispose: () => rm(dir, { recursive: true, force: true }),
  }
}
