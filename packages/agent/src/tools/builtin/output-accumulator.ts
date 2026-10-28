// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { createWriteStream, type WriteStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, type TruncationResult } from '../truncate.ts'

export interface OutputSnapshot {
  content: string
  truncation: TruncationResult
  fullOutputPath?: string
}

const byteLength = (text: string) => Buffer.byteLength(text, 'utf-8')

/**
 * Streaming output with bounded memory: keeps a decoded tail for display and spills the full raw
 * output to a temp file once it exceeds the display limits.
 */
export class OutputAccumulator {
  private readonly maxLines = DEFAULT_MAX_LINES
  private readonly maxBytes = DEFAULT_MAX_BYTES
  private readonly maxRollingBytes = DEFAULT_MAX_BYTES * 2
  private readonly decoder = new TextDecoder()
  private rawChunks: Buffer[] = []
  private tailText = ''
  private tailBytes = 0
  private tailStartsAtLineBoundary = true
  private totalBytes = 0
  private completedLines = 0
  private totalLines = 0
  private currentLineBytes = 0
  private finished = false
  private tempFilePath: string | undefined
  private tempFileStream: WriteStream | undefined

  private readonly tempDir: string
  private readonly tempFilePrefix: string

  constructor(tempDir: string = tmpdir(), tempFilePrefix = 'coko-bash') {
    this.tempDir = tempDir
    this.tempFilePrefix = tempFilePrefix
  }

  append(data: Buffer): void {
    if (this.finished) throw new Error('Cannot append to a finished output accumulator')
    this.appendDecoded(this.decoder.decode(data, { stream: true }))
    if (this.tempFileStream || this.exceedsLimits()) {
      this.ensureTempFile()
      this.tempFileStream?.write(data)
    } else if (data.length > 0) {
      this.rawChunks.push(data)
    }
  }

  finish(): void {
    if (this.finished) return
    this.finished = true
    this.appendDecoded(this.decoder.decode())
    if (this.exceedsLimits()) this.ensureTempFile()
  }

  snapshot(): OutputSnapshot {
    const tail = truncateTail(this.snapshotText(), { maxLines: this.maxLines, maxBytes: this.maxBytes })
    const truncated = this.exceedsLimits()
    const truncation: TruncationResult = {
      ...tail,
      truncated,
      truncatedBy: truncated ? (tail.truncatedBy ?? (this.totalBytes > this.maxBytes ? 'bytes' : 'lines')) : null,
      totalLines: this.totalLines,
      totalBytes: this.totalBytes,
    }
    if (truncated) this.ensureTempFile()
    return { content: truncation.content, truncation, ...(this.tempFilePath ? { fullOutputPath: this.tempFilePath } : {}) }
  }

  lastLineBytes(): number {
    return this.currentLineBytes
  }

  async closeTempFile(): Promise<void> {
    const stream = this.tempFileStream
    if (!stream) return
    this.tempFileStream = undefined
    await new Promise<void>((resolve, reject) => {
      stream.once('error', reject)
      stream.end(resolve)
    })
  }

  /** Complete output for programmatic callers; beyond `maxBytes` keeps head and tail around a marker. */
  async readFullOutput(maxBytes: number): Promise<{ content: string; truncated: boolean }> {
    if (!this.tempFilePath) return { content: new TextDecoder().decode(Buffer.concat(this.rawChunks)), truncated: false }
    const file = await open(this.tempFilePath, 'r')
    try {
      const size = (await file.stat()).size
      if (size <= maxBytes) return { content: new TextDecoder().decode(await file.readFile()), truncated: false }
      const headBytes = Math.floor(maxBytes / 2)
      const tailBytes = maxBytes - headBytes
      const head = Buffer.alloc(headBytes)
      const tail = Buffer.alloc(tailBytes)
      await file.read(head, 0, headBytes, 0)
      await file.read(tail, 0, tailBytes, size - tailBytes)
      let tailStart = 0
      while (tailStart < tail.length && ((tail[tailStart] ?? 0) & 0xc0) === 0x80) tailStart++
      const omitted = size - headBytes - tailBytes
      const headText = new TextDecoder().decode(head, { stream: true })
      return { content: `${headText}\n\n[... ${omitted} bytes omitted ...]\n\n${new TextDecoder().decode(tail.subarray(tailStart))}`, truncated: true }
    } finally {
      await file.close()
    }
  }

  private exceedsLimits(): boolean {
    return this.totalBytes > this.maxBytes || this.totalLines > this.maxLines
  }

  private appendDecoded(text: string): void {
    if (text.length === 0) return
    const bytes = byteLength(text)
    this.totalBytes += bytes
    this.tailText += text
    this.tailBytes += bytes
    if (this.tailBytes > this.maxRollingBytes * 2) this.trimTail()
    let newlines = 0
    let lastNewline = -1
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
      newlines++
      lastNewline = i
    }
    let hasOpenLine: boolean
    if (newlines === 0) {
      this.currentLineBytes += bytes
      hasOpenLine = true
    } else {
      this.completedLines += newlines
      const rest = text.slice(lastNewline + 1)
      this.currentLineBytes = byteLength(rest)
      hasOpenLine = rest.length > 0
    }
    this.totalLines = this.completedLines + (hasOpenLine ? 1 : 0)
  }

  private trimTail(): void {
    const buffer = Buffer.from(this.tailText, 'utf-8')
    let start = buffer.length - this.maxRollingBytes
    while (start < buffer.length && ((buffer[start] ?? 0) & 0xc0) === 0x80) start++
    this.tailStartsAtLineBoundary = buffer[start - 1] === 0x0a
    this.tailText = buffer.subarray(start).toString('utf-8')
    this.tailBytes = byteLength(this.tailText)
  }

  private snapshotText(): string {
    if (this.tailStartsAtLineBoundary) return this.tailText
    const firstNewline = this.tailText.indexOf('\n')
    return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1)
  }

  private ensureTempFile(): void {
    if (this.tempFilePath) return
    this.tempFilePath = join(this.tempDir, `${this.tempFilePrefix}-${randomUUID()}.log`)
    this.tempFileStream = createWriteStream(this.tempFilePath)
    for (const chunk of this.rawChunks) this.tempFileStream.write(chunk)
    this.rawChunks = []
  }
}
