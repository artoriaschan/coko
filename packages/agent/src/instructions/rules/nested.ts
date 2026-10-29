// 嵌套指令的按需加载（grilling A5）：read / write / edit / grep / find / ls 首次触及 Workspace 根之下的目录时，
// 该目录链上尚未进入上下文的指令文件以 <instruction_file scope="nested"> 块追加在该次 toolResult 末尾（随结果提交，回放稳定）。
// "已加载"从当前上下文中的 toolResult 块派生：压缩或回退移除这些块后，下次触及时重新加载；同一批并行调用经 pending 去重。
import type { AfterToolCallContext } from '@earendil-works/pi-agent-core'
import { dirname } from 'node:path'
import type { ToolHooks } from '../../extensions/hooks.ts'
import { resolveToCwd } from '../../tools/paths.ts'
import { createNodeFiles, diagnostic, type ReadOnlyFiles } from '../shared/index.ts'
import type { InstructionLoader, LoadedInstructions } from './loader.ts'
import { formatInstructionFile, nestedInstructionBlockPath } from './section.ts'

/** 触及目录的工具：前三个取目标文件所在目录，后三个取目标目录（目标是文件时取其所在目录）。 */
export const NESTED_TRIGGER_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls'])
const FILE_TOOLS = new Set(['read', 'write', 'edit'])

export interface NestedInstructionsOptions {
  loader: InstructionLoader
  /** Workspace 目录。 */
  cwd: string
  cokoHome: string
  /** 判断 grep / find / ls 的目标是文件还是目录；缺省 Node 实现。 */
  files?: ReadOnlyFiles
  /** 每次加载到文件或产生诊断时调用（日志）。 */
  onLoad?: (loaded: LoadedInstructions) => void
}

function loadedInContext(context: AfterToolCallContext['context']): Set<string> {
  const paths = new Set<string>()
  for (const message of context.messages) {
    if (message.role !== 'toolResult') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      const path = nestedInstructionBlockPath(block.text)
      if (path) paths.add(path)
    }
  }
  return paths
}

export function nestedInstructionsHook(options: NestedInstructionsOptions): ToolHooks {
  const { loader, cwd, cokoHome, onLoad } = options
  const files = options.files ?? createNodeFiles()
  // 同一条 assistant 消息的工具调用（一批）串行计算，后者看到前者已附加的文件。
  const batches = new WeakMap<object, { pending: Set<string>; tail: Promise<unknown> }>()

  async function targetDir(ctx: AfterToolCallContext): Promise<string | undefined> {
    const name = ctx.toolCall.name
    if (!NESTED_TRIGGER_TOOLS.has(name)) return undefined
    const raw = (ctx.args as { path?: unknown } | undefined)?.path
    const path = typeof raw === 'string' && raw.length > 0 ? resolveToCwd(raw, cwd) : cwd
    if (FILE_TOOLS.has(name)) return dirname(path)
    const stat = await files.stat(path).catch(() => undefined)
    return stat?.kind === 'file' ? dirname(path) : path
  }

  return {
    async afterToolCall(ctx) {
      if (ctx.isError) return undefined
      const batch = batches.get(ctx.assistantMessage) ?? { pending: new Set<string>(), tail: Promise.resolve() }
      batches.set(ctx.assistantMessage, batch)
      const run = batch.tail.then(async () => {
        const dir = await targetDir(ctx)
        if (!dir) return undefined
        const loaded = new Set([...loadedInContext(ctx.context), ...batch.pending])
        let result: LoadedInstructions
        try {
          result = await loader.nested({ cwd, cokoHome, targetDir: dir, loaded })
        } catch (error) {
          onLoad?.({
            files: [],
            diagnostics: [diagnostic('instructions', 'read-failed', error instanceof Error ? error.message : String(error))],
            totalChars: 0,
          })
          return undefined
        }
        if (result.files.length > 0 || result.diagnostics.length > 0) onLoad?.(result)
        if (result.files.length === 0) return undefined
        for (const file of result.files) batch.pending.add(file.path)
        return { content: [...ctx.result.content, ...result.files.map((file) => ({ type: 'text' as const, text: formatInstructionFile(file) }))] }
      })
      batch.tail = run.catch(() => undefined)
      return run
    },
  }
}
