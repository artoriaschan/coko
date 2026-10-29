// 按 mtime 缓存：每个 Run 开始时重新解析资源，文件未变（mtime 与大小相同）时复用上次的解析结果（docs/subsystems/instructions.md）。
import type { ReadOnlyFiles } from './files.ts'

export interface MtimeCache<T> {
  /** 文件的解析结果；不存在时 undefined。stat 与上次相同时不再读文件。parse 抛出的错误原样抛出且不缓存。 */
  load(path: string): Promise<T | undefined>
  /** 丢弃全部缓存。 */
  clear(): void
}

export function createMtimeCache<T>(files: ReadOnlyFiles, parse: (text: string, path: string) => T): MtimeCache<T> {
  const entries = new Map<string, { mtimeMs: number; size: number; value: T }>()
  return {
    async load(path) {
      const s = await files.stat(path)
      if (!s || s.kind !== 'file') {
        entries.delete(path)
        return undefined
      }
      const cached = entries.get(path)
      if (cached && cached.mtimeMs === s.mtimeMs && cached.size === s.size) return cached.value
      const value = parse(await files.readText(path), path)
      entries.set(path, { mtimeMs: s.mtimeMs, size: s.size, value })
      return value
    },
    clear() {
      entries.clear()
    },
  }
}
