// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { resolveToCwd, throwIfAborted } from '../paths.ts'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, type TruncationResult } from '../truncate.ts'
import type { CokoTool } from '../types.ts'

export const readParameters = Type.Object({
  path: Type.String({ description: 'Path to the file to read (relative or absolute)' }),
  offset: Type.Optional(Type.Number({ description: 'Line number to start reading from (1-indexed)' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to read' })),
})

export const readOutputSchema = Type.Union([
  Type.String(),
  Type.Object({ type: Type.Literal('image'), data: Type.String(), mimeType: Type.String(), note: Type.String() }),
])

export interface ReadToolDetails {
  truncation?: TruncationResult
}

/** Images above this size are not attached; M1 has no image resizing (pi uses photon wasm). */
export const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024

export function detectImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  const head = buffer.subarray(0, 6).toString('latin1')
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return undefined
}

function readText(
  buffer: Buffer,
  path: string,
  offset: number | undefined,
  limit: number | undefined,
): { text: string; details: ReadToolDetails | undefined; untruncatedText?: string } {
  const allLines = buffer.toString('utf-8').split('\n')
  const startLine = offset ? Math.max(0, offset - 1) : 0
  const startDisplay = startLine + 1
  if (startLine >= allLines.length) throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`)
  let selected: string
  let userLimited: number | undefined
  if (limit !== undefined) {
    const endLine = Math.min(startLine + limit, allLines.length)
    selected = allLines.slice(startLine, endLine).join('\n')
    userLimited = endLine - startLine
  } else {
    selected = allLines.slice(startLine).join('\n')
  }
  const truncation = truncateHead(selected)
  if (truncation.firstLineExceedsLimit) {
    const size = formatSize(Buffer.byteLength(allLines[startLine] ?? '', 'utf-8'))
    return {
      text: `[Line ${startDisplay} is ${size}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`,
      details: { truncation },
      untruncatedText: selected,
    }
  }
  if (truncation.truncated) {
    const endDisplay = startDisplay + truncation.outputLines - 1
    const limitNote = truncation.truncatedBy === 'lines' ? '' : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`
    return {
      text: `${truncation.content}\n\n[Showing lines ${startDisplay}-${endDisplay} of ${allLines.length}${limitNote}. Use offset=${endDisplay + 1} to continue.]`,
      details: { truncation },
      untruncatedText: selected,
    }
  }
  if (userLimited !== undefined && startLine + userLimited < allLines.length) {
    const remaining = allLines.length - (startLine + userLimited)
    return { text: `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${startLine + userLimited + 1} to continue.]`, details: undefined }
  }
  return { text: truncation.content, details: undefined }
}

export function createReadTool({ cwd }: { cwd: string }): CokoTool<typeof readParameters, ReadToolDetails | undefined> {
  return {
    name: 'read',
    label: 'read',
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readParameters,
    effect: 'read',
    permissionSubject: (args) => args.path,
    outputSchema: readOutputSchema,
    async execute(_toolCallId, { path, offset, limit }, signal) {
      throwIfAborted(signal)
      const absolutePath = resolveToCwd(path, cwd)
      await access(absolutePath, constants.R_OK)
      const buffer = await readFile(absolutePath)
      throwIfAborted(signal)
      const mimeType = detectImageMimeType(buffer)
      if (mimeType) {
        if (buffer.length > MAX_IMAGE_BYTES) {
          const note = `Read image file [${mimeType}]\nImage is ${formatSize(buffer.length)}, above the ${formatSize(MAX_IMAGE_BYTES)} attachment limit; it was not attached.`
          return { content: [{ type: 'text', text: note }], details: undefined, structuredContent: note }
        }
        const note = `Read image file [${mimeType}]`
        const data = buffer.toString('base64')
        const content: (TextContent | ImageContent)[] = [
          { type: 'text', text: note },
          { type: 'image', data, mimeType },
        ]
        return { content, details: undefined, structuredContent: { type: 'image', data, mimeType, note } }
      }
      const { text, details, untruncatedText } = readText(buffer, path, offset, limit)
      return { content: [{ type: 'text', text }], details, structuredContent: text, ...(untruncatedText !== undefined ? { untruncatedText } : {}) }
    },
  }
}
