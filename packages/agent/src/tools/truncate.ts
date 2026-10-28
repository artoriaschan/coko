// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

/**
 * Truncation shared by tool outputs. Two independent limits, whichever is hit first wins:
 * 2000 lines or 50KB.
 */

export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 50 * 1024
/** Max chars per grep output line. */
export const GREP_MAX_LINE_LENGTH = 500

export interface TruncationResult {
  content: string
  truncated: boolean
  truncatedBy: 'lines' | 'bytes' | null
  totalLines: number
  totalBytes: number
  outputLines: number
  outputBytes: number
  /** Last line was cut (tail truncation of a single huge line). */
  lastLinePartial: boolean
  /** First line alone exceeds the byte limit (head truncation). */
  firstLineExceedsLimit: boolean
  maxLines: number
  maxBytes: number
}

export interface TruncationOptions {
  maxLines?: number
  maxBytes?: number
}

function splitLinesForCounting(content: string): string[] {
  if (content.length === 0) return []
  const lines = content.split('\n')
  if (content.endsWith('\n')) lines.pop()
  return lines
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function untruncated(content: string, totalLines: number, totalBytes: number, maxLines: number, maxBytes: number): TruncationResult {
  return {
    content,
    truncated: false,
    truncatedBy: null,
    totalLines,
    totalBytes,
    outputLines: totalLines,
    outputBytes: totalBytes,
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  }
}

/** Keep the first lines. Never returns partial lines. */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const totalBytes = Buffer.byteLength(content, 'utf-8')
  const lines = splitLinesForCounting(content)
  const totalLines = lines.length
  if (totalLines <= maxLines && totalBytes <= maxBytes) return untruncated(content, totalLines, totalBytes, maxLines, maxBytes)

  if (Buffer.byteLength(lines[0] ?? '', 'utf-8') > maxBytes) {
    return {
      ...untruncated('', totalLines, totalBytes, maxLines, maxBytes),
      truncated: true,
      truncatedBy: 'bytes',
      outputLines: 0,
      outputBytes: 0,
      firstLineExceedsLimit: true,
    }
  }

  const output: string[] = []
  let outputBytes = 0
  let truncatedBy: 'lines' | 'bytes' = 'lines'
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i] ?? ''
    const lineBytes = Buffer.byteLength(line, 'utf-8') + (i > 0 ? 1 : 0)
    if (outputBytes + lineBytes > maxBytes) {
      truncatedBy = 'bytes'
      break
    }
    output.push(line)
    outputBytes += lineBytes
  }
  if (output.length >= maxLines && outputBytes <= maxBytes) truncatedBy = 'lines'
  const outputContent = output.join('\n')
  return {
    ...untruncated(outputContent, totalLines, totalBytes, maxLines, maxBytes),
    truncated: true,
    truncatedBy,
    outputLines: output.length,
    outputBytes: Buffer.byteLength(outputContent, 'utf-8'),
  }
}

/** Keep the last lines. May return a partial line when the last line alone exceeds the byte limit. */
export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const totalBytes = Buffer.byteLength(content, 'utf-8')
  const lines = splitLinesForCounting(content)
  const totalLines = lines.length
  if (totalLines <= maxLines && totalBytes <= maxBytes) return untruncated(content, totalLines, totalBytes, maxLines, maxBytes)

  const output: string[] = []
  let outputBytes = 0
  let truncatedBy: 'lines' | 'bytes' = 'lines'
  let lastLinePartial = false
  for (let i = lines.length - 1; i >= 0 && output.length < maxLines; i--) {
    const line = lines[i] ?? ''
    const lineBytes = Buffer.byteLength(line, 'utf-8') + (output.length > 0 ? 1 : 0)
    if (outputBytes + lineBytes > maxBytes) {
      truncatedBy = 'bytes'
      if (output.length === 0) {
        const partial = truncateStringToBytesFromEnd(line, maxBytes)
        output.unshift(partial)
        outputBytes = Buffer.byteLength(partial, 'utf-8')
        lastLinePartial = true
      }
      break
    }
    output.unshift(line)
    outputBytes += lineBytes
  }
  if (output.length >= maxLines && outputBytes <= maxBytes) truncatedBy = 'lines'
  const outputContent = output.join('\n')
  return {
    ...untruncated(outputContent, totalLines, totalBytes, maxLines, maxBytes),
    truncated: true,
    truncatedBy,
    outputLines: output.length,
    outputBytes: Buffer.byteLength(outputContent, 'utf-8'),
    lastLinePartial,
  }
}

function truncateStringToBytesFromEnd(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf-8')
  if (buffer.length <= maxBytes) return text
  let start = buffer.length - maxBytes
  while (start < buffer.length && ((buffer[start] ?? 0) & 0xc0) === 0x80) start++
  return buffer.subarray(start).toString('utf-8')
}

/** Truncate one line to `maxChars`, adding a `... [truncated]` suffix. */
export function truncateLine(line: string, maxChars: number = GREP_MAX_LINE_LENGTH): { text: string; wasTruncated: boolean } {
  if (line.length <= maxChars) return { text: line, wasTruncated: false }
  return { text: `${line.slice(0, maxChars)}... [truncated]`, wasTruncated: true }
}
