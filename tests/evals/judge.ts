// 评测判定：只看 Run 结束后的外部事实（Workspace 中的文件、工具调用数与 Run 状态），每条不满足的期望给出一条原因。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvalExpect } from './case.ts'

export interface JudgeInput {
  /** Run 结束后的 Workspace。 */
  dir: string
  /** 初始文件（相对路径 → 内容），用于 unchanged。 */
  initial: Record<string, string>
  status: string | undefined
  toolCalls: number
}

const read = (path: string) => readFile(path, 'utf8').catch(() => undefined)
const quote = (text: string) => JSON.stringify(text.length > 200 ? text.slice(0, 200) + '…' : text)

export async function judge(expect: EvalExpect, input: JudgeInput): Promise<string[]> {
  const reasons: string[] = []
  for (const [path, want] of Object.entries(expect.files ?? {})) {
    const got = await read(join(input.dir, path))
    if (got === undefined) {
      reasons.push(`files/${path}: file does not exist`)
      continue
    }
    const pattern = /^\/(.+)\/$/s.exec(want)
    if (pattern) {
      if (!new RegExp(pattern[1]!).test(got)) reasons.push(`files/${path}: expected to match ${want}, got ${quote(got)}`)
    } else if (got !== want) reasons.push(`files/${path}: expected ${quote(want)}, got ${quote(got)}`)
  }
  for (const path of expect.unchanged ?? []) {
    const got = await read(join(input.dir, path))
    if (got === undefined) reasons.push(`unchanged/${path}: file was deleted`)
    else if (got !== input.initial[path]) reasons.push(`unchanged/${path}: content changed`)
  }
  if (expect.maxToolCalls !== undefined && input.toolCalls > expect.maxToolCalls)
    reasons.push(`maxToolCalls: ${input.toolCalls} tool calls > ${expect.maxToolCalls}`)
  const status = expect.status ?? 'completed'
  if (input.status !== status) reasons.push(`status: expected ${status}, got ${input.status ?? 'none'}`)
  return reasons
}
