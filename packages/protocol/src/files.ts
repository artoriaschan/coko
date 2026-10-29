// File Reference 与嵌套指令：不是独立的条目 kind，而是同一条 user message / toolResult 中以固定开标签开头的文本块
// （M3 规格"Session Entry 与事件"）。Sidecar 用 format* 生成开标签，renderer 用 *Path 识别并显示为 chip。
// path 按 XML 属性转义（& " < >）。另有 @ 菜单的文件候选接口（票 06）。
import { Type, type Static } from 'typebox'

const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const unescapeAttribute = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

/** File Reference 文本块的开标签。 */
export function formatFileReferenceOpen(path: string): string {
  return `<file_reference path="${escapeAttribute(path)}">`
}

/** 嵌套指令（Agent 触及子目录时加载）文本块的开标签。 */
export function formatNestedInstructionOpen(path: string): string {
  return `<instruction_file path="${escapeAttribute(path)}" scope="nested">`
}

const FILE_REFERENCE = /^<file_reference path="([^"]*)">/
const NESTED_INSTRUCTION = /^<instruction_file path="([^"]*)" scope="nested">/

/** 文本块以 File Reference 开标签开头时返回其 path，否则 undefined。 */
export function fileReferencePath(text: string): string | undefined {
  const match = FILE_REFERENCE.exec(text)
  return match ? unescapeAttribute(match[1]!) : undefined
}

/** 文本块以嵌套指令开标签开头时返回其 path，否则 undefined。 */
export function nestedInstructionPath(text: string): string | undefined {
  const match = NESTED_INSTRUCTION.exec(text)
  return match ? unescapeAttribute(match[1]!) : undefined
}

const strict = { additionalProperties: false } as const

/** @ 菜单的一条候选：相对 Workspace、/ 分隔，目录以 / 结尾。 */
export const WorkspaceFileEntry = Type.Object(
  { path: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal('file'), Type.Literal('directory')]) },
  strict,
)
export type WorkspaceFileEntry = Static<typeof WorkspaceFileEntry>

/** GET /api/workspaces/:id/files?query=&limit=：模糊匹配的文件与目录（遵守忽略规则，不含 .git），最多 50 条。 */
export const WorkspaceFilesResponse = Type.Object({ files: Type.Array(WorkspaceFileEntry) }, strict)
export type WorkspaceFilesResponse = Static<typeof WorkspaceFilesResponse>

/** 候选数的上限（limit 缺省与最大值）。 */
export const WORKSPACE_FILES_LIMIT = 50

export const filePaths = {
  /** GET：查询参数 query（缺省为空，空查询按深度列出）与 limit（1–50，缺省 50）；Workspace 不存在时 404，limit 不合法时 400。 */
  workspaceFiles: (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/files`,
} as const
