import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CokoToolResult, ToolOutputRedaction } from './types.ts'

export const MAX_TOOL_OUTPUT_BYTES = 32 * 1024 * 1024
export const OUTPUT_TRUNCATED_MARKER = '\n[truncated]\n'

/** Keep a valid UTF-8 prefix within the byte budget. */
export function outputPrefix(bytes: Buffer, limit: number): Buffer {
  if (bytes.length <= limit) return bytes
  let end = limit
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--
  return bytes.subarray(0, end)
}

export const toolOutputFile = (directory: string, toolCallId: string) => join(directory, `${encodeURIComponent(toolCallId)}.txt`)

/** Bounded full-result capture; redaction precedes accounting and buffering. */
export class ToolOutputBuffer {
  private readonly chunks: string[] = []
  private readonly redactor: ReturnType<ToolOutputRedaction['stream']> | undefined
  private bytes = 0
  private lines = 0
  private capped = false
  constructor(redaction?: ToolOutputRedaction) {
    this.redactor = redaction?.stream()
  }
  appendLine(line: string): boolean {
    const text = `${this.lines++ ? '\n' : ''}${line}`
    return this.append(this.redactor ? this.redactor.push(text) : text)
  }
  result(): Pick<CokoToolResult, 'untruncatedText' | 'untruncatedTextCapped'> {
    if (!this.capped && this.redactor) this.append(this.redactor.flush())
    return { untruncatedText: this.chunks.join(''), ...(this.capped ? { untruncatedTextCapped: true } : {}) }
  }
  private append(text: string): boolean {
    if (this.capped) return false
    const bytes = Buffer.from(text, 'utf8')
    const prefix = outputPrefix(bytes, MAX_TOOL_OUTPUT_BYTES - this.bytes)
    this.chunks.push(prefix.toString('utf8'))
    this.bytes += prefix.length
    this.capped = prefix.length < bytes.length
    return !this.capped
  }
}

/** Strip the transient raw text before the result reaches hooks, progress or persistence. */
export async function storeToolOutput<T>(result: CokoToolResult<T>, path: string | undefined, redact?: (text: string) => string): Promise<CokoToolResult<T>> {
  const { untruncatedText, untruncatedTextCapped, ...visible } = result
  if (untruncatedText === undefined || !path) return visible
  const bytes = Buffer.from(redact ? redact(untruncatedText) : untruncatedText, 'utf8')
  const truncated = untruncatedTextCapped === true || bytes.length > MAX_TOOL_OUTPUT_BYTES
  const stored = truncated
    ? Buffer.concat([outputPrefix(bytes, MAX_TOOL_OUTPUT_BYTES - Buffer.byteLength(OUTPUT_TRUNCATED_MARKER)), Buffer.from(OUTPUT_TRUNCATED_MARKER)])
    : bytes
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, stored, { mode: 0o600 })
  return { ...visible, content: [...visible.content, { type: 'text', text: `Full output: ${path}${truncated ? ' [truncated]' : ''}` }] }
}
