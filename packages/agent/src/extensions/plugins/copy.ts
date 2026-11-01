// 安装与更新时复制插件目录（ADR 0017）：不复制 .git；符号链接不跟随：目标（按链接所在目录解析）在插件根之内的按相对路径在副本中重建，
// 逃出插件根的使整个复制失败（outside）；文件数与总字节数有上限（too-large，先遍历计数，超出时不写任何文件）。
import { chmod, copyFile, lstat, mkdir, readdir, readlink, realpath, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** 文件数（含符号链接）与总字节数的上限。 */
export const PLUGIN_LIMITS = { maxFiles: 5_000, maxBytes: 50 * 1024 * 1024 } as const

export type PluginCopyResult =
  | { ok: true; files: number; bytes: number }
  | { ok: false; reason: 'outside'; path: string; target: string }
  | { ok: false; reason: 'too-large'; files: number; bytes: number }

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

interface Item {
  rel: string
  kind: 'dir' | 'file' | 'link'
  mode: number
  /** link：副本中使用的相对目标。 */
  target?: string
}

/** 把 source 复制到 dest（dest 不存在或为空目录）。 */
export async function copyPluginTree(source: string, dest: string, limits: { maxFiles: number; maxBytes: number } = PLUGIN_LIMITS): Promise<PluginCopyResult> {
  const root = await realpath(source)
  // 绝对目标可能经未解析的路径（例如 /var 与 /private/var）指向插件根：先换算到真实根。
  const given = resolve(source)
  const toReal = (path: string) => (inside(given, path) ? join(root, relative(given, path)) : path)
  const items: Item[] = []
  let files = 0
  let bytes = 0
  const walk = async (rel: string): Promise<PluginCopyResult | undefined> => {
    const entries = await readdir(join(root, rel), { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const childRel = rel === '' ? entry.name : join(rel, entry.name)
      if (entry.name === '.git') continue
      const abs = join(root, childRel)
      const info = await lstat(abs)
      if (info.isSymbolicLink()) {
        const raw = await readlink(abs)
        const lexical = toReal(resolve(dirname(abs), raw))
        const real = await realpath(abs).catch(() => undefined)
        if (!inside(root, lexical) || (real !== undefined && !inside(root, real))) return { ok: false, reason: 'outside', path: childRel, target: raw }
        files++
        items.push({ rel: childRel, kind: 'link', mode: 0, target: relative(dirname(abs), lexical) || '.' })
      } else if (info.isDirectory()) {
        items.push({ rel: childRel, kind: 'dir', mode: info.mode })
        const failed = await walk(childRel)
        if (failed) return failed
      } else if (info.isFile()) {
        files++
        bytes += info.size
        items.push({ rel: childRel, kind: 'file', mode: info.mode })
      }
      // 其他类型（FIFO、socket、设备）不复制。
      if (files > limits.maxFiles || bytes > limits.maxBytes) return { ok: false, reason: 'too-large', files, bytes }
    }
    return undefined
  }
  const failed = await walk('')
  if (failed) return failed
  await mkdir(dest, { recursive: true })
  for (const item of items) {
    const to = join(dest, item.rel)
    if (item.kind === 'dir') await mkdir(to, { recursive: true })
    else if (item.kind === 'link') await symlink(item.target!, to)
    else {
      await copyFile(join(root, item.rel), to)
      await chmod(to, item.mode & 0o777)
    }
  }
  return { ok: true, files, bytes }
}
