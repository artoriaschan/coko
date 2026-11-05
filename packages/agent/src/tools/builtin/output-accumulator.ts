// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MAX_TOOL_OUTPUT_BYTES, OUTPUT_TRUNCATED_MARKER, outputPrefix } from '../output.ts'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, type TruncationResult } from '../truncate.ts'

export interface OutputSnapshot {
  content: string
  truncation: TruncationResult
  fullOutputPath?: string
  storedOutputTruncated?: boolean
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

  private pendingSpill = Buffer.alloc(0)
  private receivedSpillBytes = 0
  private storedBytes = 0
  private storedOutputTruncated = false
  private streamError: Error | undefined
  private readonly outputFile: string | undefined
  private readonly tempDir: string
  private readonly tempFilePrefix: string

  constructor(tempDir: string = tmpdir(), tempFilePrefix = 'coko-bash', outputFile?: string) {
    this.outputFile = outputFile
    this.tempDir = tempDir
    this.tempFilePrefix = tempFilePrefix
  }

  append(data: Buffer): void {
    if (this.finished) throw new Error('Cannot append to a finished output accumulator')
    this.appendOutput(this.decoder.decode(data, { stream: true }))
  }

  finish(): void {
    if (this.finished) return
    this.finished = true
    this.appendOutput(this.decoder.decode())
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
    return {
      content: truncation.content,
      truncation,
      ...(this.tempFilePath ? { fullOutputPath: this.tempFilePath } : {}),
      ...(this.storedOutputTruncated ? { storedOutputTruncated: true } : {}),
    }
  }

  lastLineBytes(): number {
    return this.currentLineBytes
  }

  async closeTempFile(): Promise<void> {
    const stream = this.tempFileStream
    if (!stream) return
    if (this.streamError) throw this.streamError
    stream.write(this.storedOutputTruncated ? Buffer.from(OUTPUT_TRUNCATED_MARKER) : this.pendingSpill)
    this.pendingSpill = Buffer.alloc(0)
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
      if (size <= maxBytes) return { content: new TextDecoder().decode(await file.readFile()), truncated: this.storedOutputTruncated }
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

  private appendOutput(text: string): void {
    this.appendDecoded(text)
    const bytes = Buffer.from(text, 'utf8')
    if (this.tempFileStream || this.exceedsLimits()) {
      this.ensureTempFile()
      this.writeBounded(bytes)
    } else if (bytes.length > 0) this.rawChunks.push(bytes)
  }

  private writeBounded(data: Buffer): void {
    if (this.storedOutputTruncated) return
    this.receivedSpillBytes += data.length
    const bytes = Buffer.concat([this.pendingSpill, data])
    const budget = MAX_TOOL_OUTPUT_BYTES - Buffer.byteLength(OUTPUT_TRUNCATED_MARKER) - this.storedBytes
    const prefix = outputPrefix(bytes, Math.max(0, budget))
    this.tempFileStream?.write(prefix)
    this.storedBytes += prefix.length
    this.storedOutputTruncated = this.receivedSpillBytes > MAX_TOOL_OUTPUT_BYTES
    this.pendingSpill = this.storedOutputTruncated ? Buffer.alloc(0) : bytes.subarray(prefix.length)
  }

  private ensureTempFile(): void {
    if (this.tempFilePath) return
    this.tempFilePath = this.outputFile ?? join(this.tempDir, `${this.tempFilePrefix}-${randomUUID()}.log`)
    mkdirSync(dirname(this.tempFilePath), { recursive: true, mode: 0o700 })
    this.tempFileStream = createWriteStream(this.tempFilePath, { mode: 0o600 })
    this.tempFileStream.on('error', (error) => {
      this.streamError = error
    })
    for (const chunk of this.rawChunks) this.writeBounded(chunk)
    this.rawChunks = []
  }
}
