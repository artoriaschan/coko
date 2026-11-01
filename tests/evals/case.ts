// 评测用例（Eval Case）的格式：cases/<name>/case.json 与 cases/<name>/workspace/（初始文件）。见 docs/subsystems/tracing.md#评测。
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type EvalPermissionMode = 'read-only' | 'default' | 'accept-edits' | 'full-access'

export interface EvalExpect {
  /** 相对 Workspace 的路径 → 完整内容，或 "/正则/"（JavaScript 语法，不带标志）。 */
  files?: Record<string, string>
  /** Run 结束后内容与初始文件相同的路径。 */
  unchanged?: string[]
  /** 工具调用（结果消息）数的上限。 */
  maxToolCalls?: number
  /** 最后一个 Run 的结束状态；缺省 completed。 */
  status?: string
}

export interface EvalCase {
  name: string
  prompt: string
  /** 缺省 full-access。read-only 与 default 下的审批由运行器拒绝（带反馈，Run 继续）。 */
  permissionMode?: EvalPermissionMode
  /** faux 模式的回复脚本（与 COKO_FAUX_SCRIPT 的 responses 相同）；真实模式不用。 */
  faux: unknown[]
  expect: EvalExpect
}

export const casesDir = fileURLToPath(new URL('./cases', import.meta.url))

/** 全部用例，按目录名排序。 */
export async function loadCases(dir = casesDir): Promise<{ dir: string; spec: EvalCase }[]> {
  const names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
  return Promise.all(
    names.sort().map(async (name) => {
      const spec = JSON.parse(await readFile(join(dir, name, 'case.json'), 'utf8')) as Omit<EvalCase, 'name'>
      return { dir: join(dir, name), spec: { name, ...spec } }
    }),
  )
}
