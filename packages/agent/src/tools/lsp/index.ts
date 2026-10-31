// 代码智能：lsp 工具（诊断、定义、引用、悬停）与 JSON-RPC 帧、位置换算、结果格式化。这里先给出宿主端口的类型。
import type { PluginLspServer } from '../../extensions/plugins/types.ts'

/** lsp 工具的操作。 */
export const LSP_OPERATIONS = ['diagnostics', 'definition', 'references', 'hover'] as const
export type LspOperation = (typeof LSP_OPERATIONS)[number]

/** 一次查询（行列 1 基）。 */
export interface LspQuery {
  operation: LspOperation
  /** 已按 Session 工作目录解析的绝对路径。 */
  path: string
  line?: number
  character?: number
}

/** 宿主的语言服务器端口：按（服务器名，cwd）管理进程，返回格式化后的文本结果。 */
export interface LspPort {
  query(query: LspQuery, signal?: AbortSignal): Promise<string>
}

export type { PluginLspServer }
