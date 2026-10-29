// 只读文件端口：加载器只经它读文件（测试可注入内存实现；Sidecar 用 Node 实现）。
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export interface FileStat {
  kind: 'file' | 'directory' | 'other'
  size: number
  mtimeMs: number
}

export interface DirectoryEntry {
  name: string
  kind: FileStat['kind']
}

export interface ReadOnlyFiles {
  /** 不存在时 undefined；其他错误照常抛出。跟随符号链接。 */
  stat(path: string): Promise<FileStat | undefined>
  readText(path: string): Promise<string>
  /** 目录项（不递归，按名字排序）；目录不存在时 []。 */
  list(path: string): Promise<DirectoryEntry[]>
}

const missing = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const kindOf = (s: { isFile(): boolean; isDirectory(): boolean }): FileStat['kind'] => (s.isFile() ? 'file' : s.isDirectory() ? 'directory' : 'other')

export function createNodeFiles(): ReadOnlyFiles {
  return {
    async stat(path) {
      try {
        const s = await stat(path)
        return { kind: kindOf(s), size: s.size, mtimeMs: s.mtimeMs }
      } catch (error) {
        if (missing(error)) return undefined
        throw error
      }
    },
    readText: (path) => readFile(path, 'utf8'),
    async list(path) {
      let names: string[]
      try {
        names = await readdir(path)
      } catch (error) {
        if (missing(error)) return []
        throw error
      }
      return Promise.all(
        names.toSorted().map(async (name): Promise<DirectoryEntry> => {
          const s = await stat(join(path, name)).catch(() => undefined)
          return { name, kind: s ? kindOf(s) : 'other' }
        }),
      )
    },
  }
}
