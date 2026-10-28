// 判定用的路径事实：把工具参数解析为绝对路径与真实路径（经符号链接，包括指向不存在目标的链接）。
import { lstat, readlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { PermissionMode } from '../session-entries/index.ts'
import { resolveToCwd } from '../tools/paths.ts'
import type { PermissionTarget } from './decide.ts'

const MAX_LINKS = 40

/**
 * 路径的真实位置：存在的部分经 realpath；不存在的尾部按原样拼接；尾部本身是悬空符号链接时按链接目标继续解析，
 * 使"Workspace 内指向外部的链接"按外部位置判定。
 */
export async function realLocation(path: string, depth = 0): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    // 不存在或不可解析：看它是不是悬空链接，否则解析父目录后拼回名字。
  }
  if (depth < MAX_LINKS) {
    const info = await lstat(path).catch(() => undefined)
    if (info?.isSymbolicLink()) {
      const link = await readlink(path)
      return realLocation(isAbsolute(link) ? link : resolve(dirname(path), link), depth + 1)
    }
  }
  const parent = dirname(path)
  if (parent === path) return path
  return join(await realLocation(parent, depth), basename(path))
}

/** 文件工具参数在 Workspace 下的目标。 */
export async function resolveTarget(subject: string, cwd: string): Promise<PermissionTarget> {
  const resolved = resolveToCwd(subject, cwd)
  return { resolved, real: await realLocation(resolved) }
}

/** 系统临时目录的真实路径（macOS 上 /tmp 与 os.tmpdir() 都是 /private 下的链接）。 */
async function tempRoots(): Promise<string[]> {
  const roots = await Promise.all([tmpdir(), '/tmp'].map((dir) => realpath(dir).catch(() => undefined)))
  return [...new Set(roots.filter((root): root is string => root !== undefined))]
}

/**
 * 模式对应的可写根（ADR 0005）：read-only 没有；default 与 accept-edits 为 Workspace 与系统临时目录；
 * full-access 为根目录（文件写入只受拒绝规则与受保护路径约束）。
 */
export async function writableRootsFor(mode: PermissionMode, workspace: string): Promise<string[]> {
  if (mode === 'read-only') return []
  if (mode === 'full-access') return ['/']
  return [workspace, ...(await tempRoots())]
}
