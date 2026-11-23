// @ 引用的展开（docs/subsystems/context.md）：每个引用生成一个以 <file_reference path="…"> 开头的文本块，追加到同一条 user message。
// Workspace 内的文件按 read 工具的截断（2000 行 / 50KB）读入，目录给出 ls 式列表（最多 200 项）；单条消息最多 10 个、合计 200KB。
// Read 拒绝规则覆盖、Workspace 外（含经符号链接）、二进制或超出上限时只附一行说明。用户显式引用视为读取授权：询问规则不适用，拒绝规则仍生效。
// 不存在的路径不产生块（@someone 这类提及原样留在文本中）。
// Session Reference（@session:<id>）在同一个循环中按出现顺序展开为 <session_reference id="…" title="…"> 块，与文件引用共用数量与
// 合计额度；范围判定与条目读取由宿主经 resolveSession 给出，记录的序列化见 session.ts。
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { contextReadDenial } from '../../policy/decide.ts'
import { pathContains } from '../../policy/rules.ts'
import type { PermissionRule } from '../../session-entries/index.ts'
import { resolveToCwd } from '../../tools/paths.ts'
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from '../../tools/truncate.ts'
import type { EntryLike } from '../../entries/index.ts'
import { formatFileReferenceOpen, parseFileReferences, parseSessionReferences } from '@coko/protocol'
import { EMPTY_SESSION_NOTE, NOTICE_RESERVE, SESSION_REFERENCE_MAX_BYTES, sessionReferenceBlock, sessionTranscript } from './session.ts'

export const FILE_REFERENCE_MAX_COUNT = 10
export const FILE_REFERENCE_MESSAGE_BYTES = 200 * 1024
export const FILE_REFERENCE_DIRECTORY_LIMIT = 200
/** 读入的上限：更大的文件只读开头这一段（截断说明给出文件大小）。 */
const MAX_READ_BYTES = 4 * 1024 * 1024
/** 与 git 相同：开头 8000 字节中有 NUL 即视为二进制。 */
const BINARY_SNIFF_BYTES = 8000

/** 不附内容时块中的说明（英文，发给模型）。 */
export const FILE_REFERENCE_NOTES = {
  denied: '[Not attached: denied by permission rules.]',
  outside: '[Not attached: the path is outside the Workspace.]',
  binary: '[Not attached: binary file.]',
  unreadable: '[Not attached: the file could not be read.]',
  count: `[Not attached: at most ${FILE_REFERENCE_MAX_COUNT} file references per message.]`,
  budget: `[Not attached: file references in this message exceed ${FILE_REFERENCE_MESSAGE_BYTES / 1024}KB in total.]`,
} as const

/** 会话引用不附记录时块中的说明（英文，发给模型）；数量与合计额度与文件引用共用，说明文本各用各的。 */
export const SESSION_REFERENCE_NOTES = {
  empty: EMPTY_SESSION_NOTE,
  outOfProject: '[Not attached: the session does not belong to the current project.]',
  notReferable: '[Not attached: this session cannot be referenced.]',
  count: `[Not attached: at most ${FILE_REFERENCE_MAX_COUNT} references per message.]`,
  budget: `[Not attached: references in this message exceed ${FILE_REFERENCE_MESSAGE_BYTES / 1024}KB in total.]`,
} as const

export type FileReferenceStatus = 'file' | 'directory' | 'denied' | 'outside' | 'binary' | 'unreadable' | 'skipped'

export interface ExpandedFileReference {
  /** 开标签中的路径：Workspace 内为相对路径（/ 分隔，目录以 / 结尾），其外为输入的原文。 */
  path: string
  status: FileReferenceStatus
  /** 内容被截断（行数、50KB 或合计上限）。 */
  truncated: boolean
}

/**
 * 宿主对 `@session:<id>` 的判定：范围内给出标题与全部已提交条目，范围外只给标题（附一行说明）；
 * 会话不存在时宿主返回 undefined（不产生块）。
 */
export type SessionReferenceResolution =
  | { status: 'attached'; title: string; entries: readonly EntryLike[] }
  | { status: 'out-of-project' | 'not-referable'; title: string }

export interface ExpandedSessionReference {
  status: 'attached' | 'out-of-project' | 'not-referable' | 'skipped'
  /** 记录被截断（50KB 或合计上限）。 */
  truncated: boolean
}

export interface ExpandFileReferencesOptions {
  /** Workspace 目录。 */
  cwd: string
  /** 当时生效的权限规则：其中的 Read 拒绝规则作用于引用。 */
  rules: readonly PermissionRule[]
  /** `~/` 与规则中 `~` 的主目录；缺省 os.homedir()。 */
  home?: string
  /** Session Reference 的解析入口（范围判定与条目读取在宿主）；省略时 `@session:<id>` 不产生块。 */
  resolveSession?: (id: string) => Promise<SessionReferenceResolution | undefined>
  /**
   * 登记明文的替换（ADR 0007，宿主给出）：作用于开标签中的路径与标题、文件内容、目录列表与会话记录，且在转义与截断之前——转义后的形态
   * （`&` → `&amp;`）与截断留下的前缀都匹配不上登记值。省略时不替换。
   */
  redact?: (text: string) => string
}

export interface ExpandedFileReferences {
  /** 文件引用与会话引用的块，按在文本中出现的顺序。 */
  blocks: { type: 'text'; text: string }[]
  references: ExpandedFileReference[]
  /** 会话引用（不含 id、标题与内容：供日志计数）。 */
  sessionReferences: ExpandedSessionReference[]
}

const block = (path: string, body: string) => `${formatFileReferenceOpen(path)}\n${body}\n</file_reference>`
const toPosix = (path: string) => (sep === '/' ? path : path.split(sep).join('/'))

async function readHead(path: string, size: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const length = Math.min(size, MAX_READ_BYTES)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** 文件内容（按 read 截断，maxBytes 不超过剩余的合计预算）；预算不够放下第一行时 undefined。 */
function fileBody(
  buffer: Buffer,
  size: number,
  maxBytes: number,
  redact: (text: string) => string,
): { body: string; bytes: number; truncated: boolean } | undefined {
  const text = redact(buffer.toString('utf-8'))
  const truncation = truncateHead(text, { maxBytes })
  const partial = size > buffer.length
  if (truncation.firstLineExceedsLimit) {
    if (maxBytes < DEFAULT_MAX_BYTES) return undefined
    return { body: `[Line 1 exceeds the ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash to view part of it.]`, bytes: 0, truncated: true }
  }
  if (!truncation.truncated && !partial) return { body: truncation.content, bytes: truncation.outputBytes, truncated: false }
  const limit = truncation.truncatedBy === 'bytes' ? ` (${formatSize(maxBytes)} limit)` : ''
  const of = partial ? `a ${formatSize(size)} file` : String(truncation.totalLines)
  const next = truncation.outputLines + 1
  return {
    body: `${truncation.content}\n\n[Showing lines 1-${truncation.outputLines} of ${of}${limit}. Use the read tool with offset=${next} to continue.]`,
    bytes: truncation.outputBytes,
    truncated: true,
  }
}

async function directoryBody(dir: string, denied: (path: string) => boolean): Promise<{ body: string; truncated: boolean }> {
  const names = (await readdir(dir)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const lines: string[] = []
  let omitted = 0
  let more = 0
  for (const name of names) {
    const path = join(dir, name)
    if (denied(path)) {
      omitted++
      continue
    }
    if (lines.length >= FILE_REFERENCE_DIRECTORY_LIMIT) {
      more++
      continue
    }
    try {
      lines.push((await stat(path)).isDirectory() ? `${name}/` : name)
    } catch {
      // 断开的符号链接。
    }
  }
  const notices: string[] = []
  if (more > 0) notices.push(`[${FILE_REFERENCE_DIRECTORY_LIMIT} entries limit reached; ${more} more not shown]`)
  if (omitted > 0) notices.push(`[${omitted} ${omitted === 1 ? 'entry' : 'entries'} omitted: denied by permission rules]`)
  const listing = lines.length === 0 ? '(empty directory)' : lines.join('\n')
  return { body: notices.length === 0 ? listing : `${listing}\n\n${notices.join('\n')}`, truncated: more > 0 }
}

/** 解析 text 中的 @ 引用并生成文本块（按出现顺序）。 */
export async function expandFileReferences(text: string, options: ExpandFileReferencesOptions): Promise<ExpandedFileReferences> {
  const home = options.home ?? homedir()
  const redact = options.redact ?? ((value: string) => value)
  const tokens = [...parseFileReferences(text), ...parseSessionReferences(text)].sort((a, b) => a.start - b.start)
  const out: ExpandedFileReferences = { blocks: [], references: [], sessionReferences: [] }
  if (tokens.length === 0) return out
  /** 文件引用与会话引用共用每条消息的数量上限。 */
  const full = () => out.references.length + out.sessionReferences.length >= FILE_REFERENCE_MAX_COUNT
  const root = await realpath(options.cwd).catch(() => options.cwd)
  const denied = contextReadDenial(options.rules, root, home)
  const isDenied = (resolved: string, real: string) => denied(resolved) || denied(real)
  const seen = new Set<string>()
  let budget = FILE_REFERENCE_MESSAGE_BYTES
  const push = (path: string, status: FileReferenceStatus, body: string, truncated = false) => {
    out.blocks.push({ type: 'text', text: block(redact(path), body) })
    out.references.push({ path, status, truncated })
  }

  for (const token of tokens) {
    if ('id' in token) {
      const key = `session:${token.id}`
      const session = seen.has(key) ? undefined : await options.resolveSession?.(token.id)
      if (!session) continue
      seen.add(key)
      const pushSession = (status: ExpandedSessionReference['status'], body: string, truncated = false) => {
        out.blocks.push({ type: 'text', text: sessionReferenceBlock(token.id, redact(session.title), body) })
        out.sessionReferences.push({ status, truncated })
      }
      // 说明块计入数量上限，不计入字节额度。
      if (full()) pushSession('skipped', SESSION_REFERENCE_NOTES.count)
      else if (session.status !== 'attached')
        pushSession(session.status, session.status === 'out-of-project' ? SESSION_REFERENCE_NOTES.outOfProject : SESSION_REFERENCE_NOTES.notReferable)
      else if (budget <= 0) pushSession('skipped', SESSION_REFERENCE_NOTES.budget)
      else {
        const transcript = sessionTranscript(session.entries, { maxBytes: Math.min(SESSION_REFERENCE_MAX_BYTES, budget), redact })
        // 剩余额度放不下完整记录、也不够截断后留下任何消息内容：与额度用尽相同，只附说明（不附只有省略说明的块，合计不超额度）。
        if (transcript.truncated && budget < NOTICE_RESERVE) pushSession('skipped', SESSION_REFERENCE_NOTES.budget)
        else {
          budget -= transcript.bytes
          pushSession('attached', transcript.body, transcript.truncated)
        }
      }
      continue
    }
    const resolved = token.path.startsWith('~/') ? join(home, token.path.slice(2)) : resolveToCwd(token.path, options.cwd)
    let info
    let real
    try {
      info = await stat(resolved)
      real = await realpath(resolved)
    } catch {
      continue
    }
    if (seen.has(real)) continue
    seen.add(real)
    const inside = pathContains(root, real) && pathContains(root, resolveToCwd(token.path, root))
    const relativePath = toPosix(relative(root, real))
    const shown = !inside ? token.path : info.isDirectory() ? (relativePath === '' ? './' : `${relativePath}/`) : relativePath
    if (full()) {
      push(shown, 'skipped', FILE_REFERENCE_NOTES.count)
      continue
    }
    if (!inside) {
      push(shown, 'outside', FILE_REFERENCE_NOTES.outside)
      continue
    }
    if (isDenied(resolved, real)) {
      push(shown, 'denied', FILE_REFERENCE_NOTES.denied)
      continue
    }
    if (budget <= 0) {
      push(shown, 'skipped', FILE_REFERENCE_NOTES.budget)
      continue
    }
    try {
      if (info.isDirectory()) {
        const { body: listing, truncated } = await directoryBody(real, (path) => denied(path))
        const body = redact(listing)
        budget -= Buffer.byteLength(body, 'utf-8')
        push(shown, 'directory', body, truncated)
        continue
      }
      const buffer = await readHead(real, info.size)
      if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
        push(shown, 'binary', FILE_REFERENCE_NOTES.binary)
        continue
      }
      const content = fileBody(buffer, info.size, Math.min(DEFAULT_MAX_BYTES, budget), redact)
      if (!content) {
        push(shown, 'skipped', FILE_REFERENCE_NOTES.budget)
        continue
      }
      budget -= content.bytes
      push(shown, 'file', content.body, content.truncated)
    } catch {
      push(shown, 'unreadable', FILE_REFERENCE_NOTES.unreadable)
    }
  }
  return out
}
