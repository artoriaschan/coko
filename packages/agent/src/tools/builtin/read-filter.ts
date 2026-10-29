// grep / find / ls 的读取拒绝过滤：执行上下文的 readDenied 命中的路径不出现在结果中（ADR 0005：拒绝规则在任何模式下都生效）。
import { realpath } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { pathContains } from '../../policy/rules.ts'
import type { ToolExecutionContext } from '../types.ts'

export interface ReadFilter {
  /** 路径（绝对，按搜索根拼出）是否被拒绝：按该路径与经搜索根真实路径换算后的路径判定。 */
  denied(path: string): boolean
  /** 已排除的路径数。 */
  readonly omitted: number
  /** 结果末尾的说明；没有排除时为 undefined。 */
  notice(): string | undefined
}

/**
 * 某次调用的过滤器。目录遍历不跟随符号链接，所以搜索根下的路径只需按根的真实路径换算一次（根本身是链接时也按链接目标判定）。
 * 没有 readDenied 时什么都不排除。
 */
export async function createReadFilter(context: ToolExecutionContext | undefined, root: string): Promise<ReadFilter> {
  const readDenied = context?.readDenied
  let omitted = 0
  if (!readDenied) return { denied: () => false, omitted: 0, notice: () => undefined }
  const realRoot = await realpath(root).catch(() => root)
  return {
    denied(path) {
      const rel = relative(root, path)
      const hit = readDenied(path) || (realRoot !== root && pathContains(root, path) && readDenied(join(realRoot, rel)))
      if (hit) omitted++
      return hit
    },
    get omitted() {
      return omitted
    },
    notice: () => (omitted === 0 ? undefined : `${omitted} ${omitted === 1 ? 'path' : 'paths'} omitted: denied by permission rules`),
  }
}
