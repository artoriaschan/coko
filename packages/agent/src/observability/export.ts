// 会话导出（application/x-ndjson，docs/subsystems/tracing.md#导出与回放）：第一行 header，其后每行一个已提交的条目（已脱敏；子 Session 的
// 条目带各自的 sessionId）。loadExport 读回条目，供 modelContext、deriveTrace、deriveAudit 等纯函数回放。

export const SESSION_EXPORT_FORMAT = 'coko-session-export'
export const SESSION_EXPORT_VERSION = 1

export interface SessionExportHeader {
  type: 'header'
  format: typeof SESSION_EXPORT_FORMAT
  version: typeof SESSION_EXPORT_VERSION
  sessionId: string
  exportedAt: number
}

/** 导出中的一个条目（与 @coko/session 的 SessionEntry 相同的字段）。 */
export interface SessionExportEntry {
  sessionId: string
  seq: number
  kind: string
  payloadVersion: number
  payload: unknown
  runId: string | null
  createdAt: number
}

export function sessionExportHeader(sessionId: string, exportedAt: number): SessionExportHeader {
  return { type: 'header', format: SESSION_EXPORT_FORMAT, version: SESSION_EXPORT_VERSION, sessionId, exportedAt }
}

/** header 与条目的 ndjson 文本（每行以换行结尾）。 */
export function formatExport(header: SessionExportHeader, entries: readonly SessionExportEntry[]): string {
  return [header, ...entries].map((line) => JSON.stringify(line) + '\n').join('')
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isInt = (value: unknown) => typeof value === 'number' && Number.isInteger(value)

function isEntry(value: unknown): value is SessionExportEntry {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    isInt(value.seq) &&
    typeof value.kind === 'string' &&
    isInt(value.payloadVersion) &&
    'payload' in value &&
    (value.runId === null || typeof value.runId === 'string') &&
    isInt(value.createdAt)
  )
}

/** 解析导出文本，返回 header 之后的条目（按文件顺序）；格式不符时抛出。 */
export function loadExport(text: string): SessionExportEntry[] {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  const parse = (line: string, n: number): unknown => {
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`Invalid session export: line ${n} is not JSON`)
    }
  }
  if (lines.length === 0) throw new Error('Invalid session export: empty')
  const header = parse(lines[0]!, 1)
  if (!isRecord(header) || header.type !== 'header' || header.format !== SESSION_EXPORT_FORMAT || header.version !== SESSION_EXPORT_VERSION)
    throw new Error(`Invalid session export: the first line must be a ${SESSION_EXPORT_FORMAT} v${SESSION_EXPORT_VERSION} header`)
  return lines.slice(1).map((line, i) => {
    const entry = parse(line, i + 2)
    if (!isEntry(entry)) throw new Error(`Invalid session export: line ${i + 2} is not an entry`)
    return entry
  })
}
