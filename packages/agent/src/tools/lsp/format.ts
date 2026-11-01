// lsp 工具的结果格式化：diagnostics 为 `<rel>:<line>:<col> <severity> <message> [<source>]`；definition / references 为 `<rel>:<line>:<col>` 加该行文本；
// hover 为 markdown 文本。行列为 1 基码点。至多 LSP_MAX_ITEMS 项、LSP_MAX_CHARS 字符，超出注明总数。Workspace 外的路径写绝对路径。
import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fromLspPosition, type LspPosition, type LspRange } from './position.ts'

export const LSP_MAX_ITEMS = 200
export const LSP_MAX_CHARS = 20_000
/** definition / references 每项附带的该行文本上限（字符）。 */
export const LSP_LINE_TEXT_MAX = 200
/** 等待 publishDiagnostics 的缺省时长。 */
export const LSP_DIAGNOSTICS_WAIT_MS = 5_000

/** 服务器发来的诊断（publishDiagnostics 的一项）。 */
export interface LspDiagnostic {
  range: LspRange
  severity?: number
  message: string
  source?: string
  code?: number | string
}

export interface LspLocation {
  uri: string
  range: LspRange
}

export interface LspLocationLink {
  targetUri: string
  targetRange: LspRange
  targetSelectionRange?: LspRange
}

/** 端口返回的原始结果（服务器的回答，未格式化）。diagnostics 为 undefined：等待超时，没有收到诊断。 */
export type LspQueryResult =
  | { kind: 'diagnostics'; diagnostics: LspDiagnostic[] | undefined }
  | { kind: 'locations'; operation: 'definition' | 'references'; locations: LspLocation | (LspLocation | LspLocationLink)[] | null | undefined }
  | { kind: 'hover'; hover: { contents: unknown } | null | undefined }

export interface LspResultCounts {
  /** 显示的项数。 */
  count: number
  /** 服务器给出的项数。 */
  total: number
  truncated: boolean
  /** 只在诊断等待超时时为 false。 */
  received?: false
}

export interface LspFormatOptions {
  /** Session 工作目录：其中的路径写相对路径。 */
  cwd: string
  /** 查询的文件（绝对路径）。 */
  file: string
  /** 结果所在文件的当前文本（列的换算与该行文本）；不可读或不应读取时 undefined。 */
  readText(path: string): string | undefined
}

const SEVERITY: Record<number, string> = { 1: 'error', 2: 'warning', 3: 'information', 4: 'hint' }

/** Workspace 内为相对路径，外为绝对路径（不跟随符号链接：只是显示）。 */
export function displayPath(cwd: string, path: string): string {
  const rel = relative(cwd, path)
  if (rel === '') return '.'
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel
}

/** file: URI → 路径；其他 scheme 原样。 */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file:')) return uri
  try {
    return fileURLToPath(uri)
  } catch {
    return uri
  }
}

const oneLine = (text: string) =>
  text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')

const isPosition = (value: unknown): value is LspPosition =>
  typeof value === 'object' && value !== null && Number.isInteger((value as LspPosition).line) && Number.isInteger((value as LspPosition).character)
const startOf = (range: unknown): LspPosition | undefined => {
  const start = (range as { start?: unknown } | null | undefined)?.start
  return isPosition(start) ? start : undefined
}

/** 定义与引用的结果统一为（路径，起点）；无法识别的项跳过。 */
export function normalizeLocations(locations: unknown): { path: string; start: LspPosition }[] {
  const items = locations === null || locations === undefined ? [] : Array.isArray(locations) ? locations : [locations]
  return items.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const link = item as Partial<LspLocationLink>
    if (typeof link.targetUri === 'string') {
      const start = startOf(link.targetSelectionRange) ?? startOf(link.targetRange)
      return start ? [{ path: uriToPath(link.targetUri), start }] : []
    }
    const location = item as Partial<LspLocation>
    const start = typeof location.uri === 'string' ? startOf(location.range) : undefined
    return start ? [{ path: uriToPath(location.uri!), start }] : []
  })
}

/** hover 的 contents（MarkupContent、MarkedString 或其数组）→ markdown 文本。 */
export function hoverText(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents))
    return contents
      .map(hoverText)
      .filter((part) => part.trim() !== '')
      .join('\n\n')
  if (typeof contents === 'object' && contents !== null) {
    const value = (contents as { value?: unknown }).value
    const language = (contents as { language?: unknown }).language
    if (typeof value !== 'string') return ''
    return typeof language === 'string' ? '```' + language + '\n' + value + '\n```' : value
  }
  return ''
}

/** 逐行累加，至多 LSP_MAX_ITEMS 项与 LSP_MAX_CHARS 字符；超出时注明总数。 */
function limited(lines: string[], noun: string): { text: string; counts: LspResultCounts } {
  const shown: string[] = []
  let chars = 0
  for (const line of lines) {
    if (shown.length >= LSP_MAX_ITEMS || chars + line.length + 1 > LSP_MAX_CHARS) break
    shown.push(line)
    chars += line.length + 1
  }
  const truncated = shown.length < lines.length
  const text = shown.join('\n') + (truncated ? `\n\n[Showing ${shown.length} of ${lines.length} ${noun}.]` : '')
  return { text, counts: { count: shown.length, total: lines.length, truncated } }
}

export function formatLspResult(result: LspQueryResult, options: LspFormatOptions): { text: string; details: LspResultCounts } {
  const { cwd, file, readText } = options
  const fileLabel = displayPath(cwd, file)
  switch (result.kind) {
    case 'diagnostics': {
      if (result.diagnostics === undefined)
        return {
          text: `No diagnostics received for ${fileLabel} within ${LSP_DIAGNOSTICS_WAIT_MS / 1000} seconds. The language server may still be indexing; try again later.`,
          details: { count: 0, total: 0, truncated: false, received: false },
        }
      if (result.diagnostics.length === 0) return { text: `No diagnostics for ${fileLabel}.`, details: { count: 0, total: 0, truncated: false } }
      const text = readText(file)
      const rows = result.diagnostics
        .map((d) => ({ d, start: startOf(d.range) ?? { line: 0, character: 0 } }))
        .sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character)
        .map(({ d, start }) => {
          const at = fromLspPosition(text, start)
          const severity = SEVERITY[d.severity ?? 1] ?? 'error'
          const source = typeof d.source === 'string' && d.source !== '' ? ` [${d.source}]` : ''
          return `${fileLabel}:${at.line}:${at.character} ${severity} ${oneLine(String(d.message ?? ''))}${source}`
        })
      const out = limited(rows, 'diagnostics')
      return { text: out.text, details: out.counts }
    }
    case 'locations': {
      const locations = normalizeLocations(result.locations)
      const noun = result.operation === 'definition' ? 'definitions' : 'references'
      if (locations.length === 0)
        return { text: result.operation === 'definition' ? 'No definition found.' : 'No references found.', details: { count: 0, total: 0, truncated: false } }
      const rows = locations.map(({ path, start }) => {
        const text = readText(path)
        const at = fromLspPosition(text, start)
        const label = `${displayPath(cwd, path)}:${at.line}:${at.character}`
        const line = text === undefined ? undefined : (text.split(/\r\n|\r|\n/)[start.line] ?? '').trim()
        if (!line) return label
        const points = Array.from(line)
        return `${label} ${points.length > LSP_LINE_TEXT_MAX ? points.slice(0, LSP_LINE_TEXT_MAX).join('') + '…' : line}`
      })
      const out = limited(rows, noun)
      return { text: out.text, details: out.counts }
    }
    case 'hover': {
      const text = hoverText(result.hover?.contents).trim()
      if (text === '') return { text: 'No hover information.', details: { count: 0, total: 0, truncated: false } }
      if (text.length <= LSP_MAX_CHARS) return { text, details: { count: 1, total: 1, truncated: false } }
      return {
        text: text.slice(0, LSP_MAX_CHARS) + `\n\n[Hover truncated: ${text.length} characters in total.]`,
        details: { count: 1, total: 1, truncated: true },
      }
    }
  }
}
