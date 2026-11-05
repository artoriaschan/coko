// lsp 工具：operation 为 diagnostics / definition / references / hover，file_path 按读取判定（权限类 lsp），行列 1 基。工具读磁盘当前内容
// 交给端口（文档同步与位置换算），端口（宿主的语言服务器进程）返回原始结果，这里格式化。
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { Type } from 'typebox'
import { resolveToCwd, throwIfAborted } from '../paths.ts'
import type { CokoTool } from '../types.ts'
import { displayPath, formatLspResult, LSP_MAX_ITEMS, normalizeLocations, type LspQueryResult, type LspResultCounts } from './format.ts'
import { toLspPosition, type LspPosition } from './position.ts'

/** lsp 工具的操作。 */
export const LSP_OPERATIONS = ['diagnostics', 'definition', 'references', 'hover'] as const
export type LspOperation = (typeof LSP_OPERATIONS)[number]

/** 一次查询：path 为已解析的绝对路径，text 为磁盘当前内容；position 为换算后的 0 基 UTF-16 位置（diagnostics 没有）。 */
export interface LspQuery {
  operation: LspOperation
  path: string
  text: string
  position?: LspPosition
  /** 工具参数中的 1 基行列（日志与诊断用）。 */
  line?: number
  character?: number
}

/** 宿主的语言服务器端口：按（服务器名，cwd）管理进程。 */
export interface LspPort {
  /** 已配置的扩展名（含点）。 */
  extensions(): readonly string[]
  query(query: LspQuery, signal?: AbortSignal): Promise<LspQueryResult>
  /**
   * 结果所在文件的文本（列的换算与该行文本）；不应读取（越出可读根或被 Read 拒绝规则覆盖）时 undefined，结果只给位置。
   * 省略时直接读磁盘。
   */
  readText?(path: string): Promise<string | undefined>
}

export const lspParameters = Type.Object({
  operation: Type.Union([Type.Literal('diagnostics'), Type.Literal('definition'), Type.Literal('references'), Type.Literal('hover')], {
    description: 'diagnostics: errors and warnings for the file; definition / references / hover: for the symbol at line and character',
  }),
  file_path: Type.String({ description: 'Path to the file (relative to the working directory or absolute)' }),
  line: Type.Optional(Type.Integer({ minimum: 1, description: 'Line number (1-based); required except for diagnostics' })),
  character: Type.Optional(Type.Integer({ minimum: 1, description: 'Column (1-based, in characters); required except for diagnostics' })),
})

export interface LspToolDetails extends LspResultCounts {
  operation: LspOperation
  /** Workspace 内为相对路径。 */
  file: string
  line?: number
  character?: number
}

const defaultReadText = async (path: string) => readFile(path, 'utf8').catch(() => undefined)

export function createLspTool({ cwd, port }: { cwd: string; port: LspPort }): CokoTool<typeof lspParameters, LspToolDetails> {
  const extensions = port.extensions()
  return {
    name: 'lsp',
    label: 'lsp',
    description:
      'Query the language server for a file: diagnostics (type errors and warnings after you edit), definition, references or hover for the symbol at a ' +
      `position. line and character are 1-based. Configured file extensions: ${extensions.join(', ')}.`,
    parameters: lspParameters,
    effect: 'read',
    permissionSubject: (args) => args.file_path,
    async execute(_toolCallId, params, signal) {
      throwIfAborted(signal)
      const { operation, file_path: filePath, line, character } = params
      if (operation !== 'diagnostics' && (line === undefined || character === undefined))
        throw new Error(`The ${operation} operation requires line and character (1-based)`)
      const path = resolveToCwd(filePath, cwd)
      const ext = extname(path)
      if (!extensions.includes(ext))
        throw new Error(
          `No language server is configured for ${ext === '' ? 'files without an extension' : `${ext} files`}. Configured extensions: ${extensions.join(', ')}`,
        )
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        throw new Error(`Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
      const position = operation === 'diagnostics' ? undefined : toLspPosition(text, line!, character!)
      const result = await port.query({ operation, path, text, ...(position ? { position, line: line!, character: character! } : {}) }, signal)
      // 结果所在文件的文本：查询的文件用刚读的内容，其余经端口（可读根与 Read 拒绝规则由宿主判断）。
      const texts = new Map<string, string | undefined>([[path, text]])
      if (result.kind === 'locations') {
        const read = port.readText?.bind(port) ?? defaultReadText
        const paths = [
          ...new Set(
            normalizeLocations(result.locations)
              .slice(0, LSP_MAX_ITEMS)
              .map((l) => l.path),
          ),
        ].filter((p) => !texts.has(p))
        await Promise.all(paths.map(async (p) => texts.set(p, await read(p))))
      }
      const formatted = formatLspResult(result, { cwd, file: path, readText: (p) => texts.get(p) })
      return {
        content: [{ type: 'text', text: formatted.text }],
        ...(formatted.untruncatedText !== undefined ? { untruncatedText: formatted.untruncatedText } : {}),
        details: {
          operation,
          file: displayPath(cwd, path),
          ...(position ? { line: line!, character: character! } : {}),
          ...formatted.details,
        },
      }
    },
  }
}
