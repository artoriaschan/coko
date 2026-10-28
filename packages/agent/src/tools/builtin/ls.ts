// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Type } from 'typebox'
import { resolveToCwd, throwIfAborted } from '../paths.ts'
import { DEFAULT_MAX_BYTES, formatSize, truncateHead, type TruncationResult } from '../truncate.ts'
import type { CokoTool } from '../types.ts'
import { createReadFilter } from './read-filter.ts'

export const lsParameters = Type.Object({
  path: Type.Optional(Type.String({ description: 'Directory to list (default: current directory)' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of entries to return (default: 500)' })),
})

const DEFAULT_LIMIT = 500

export interface LsToolDetails {
  truncation?: TruncationResult
  entryLimitReached?: number
}

export function createLsTool({ cwd }: { cwd: string }): CokoTool<typeof lsParameters, LsToolDetails | undefined> {
  return {
    name: 'ls',
    label: 'ls',
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: lsParameters,
    effect: 'read',
    permissionSubject: (args) => args.path ?? '.',
    async execute(_toolCallId, { path, limit }, signal, _onUpdate, context) {
      throwIfAborted(signal)
      const dirPath = resolveToCwd(path || '.', cwd)
      const effectiveLimit = limit ?? DEFAULT_LIMIT
      let info
      try {
        info = await stat(dirPath)
      } catch {
        throw new Error(`Path not found: ${dirPath}`)
      }
      if (!info.isDirectory()) throw new Error(`Not a directory: ${dirPath}`)
      let entries: string[]
      try {
        entries = await readdir(dirPath)
      } catch (error) {
        throw new Error(`Cannot read directory: ${(error as Error).message}`)
      }
      entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      const filter = await createReadFilter(context, dirPath)
      entries = entries.filter((entry) => !filter.denied(join(dirPath, entry)))
      const results: string[] = []
      let entryLimitReached = false
      for (const entry of entries) {
        if (results.length >= effectiveLimit) {
          entryLimitReached = true
          break
        }
        try {
          results.push((await stat(join(dirPath, entry))).isDirectory() ? `${entry}/` : entry)
        } catch {
          // Skip entries that cannot be stat'ed (broken symlinks).
        }
      }
      throwIfAborted(signal)
      const omitted = filter.notice()
      if (results.length === 0)
        return { content: [{ type: 'text', text: omitted ? `(empty directory)\n\n[${omitted}]` : '(empty directory)' }], details: undefined }

      const truncation = truncateHead(results.join('\n'), { maxLines: Number.MAX_SAFE_INTEGER })
      let text = truncation.content
      const details: LsToolDetails = {}
      const notices: string[] = []
      if (entryLimitReached) {
        notices.push(`${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`)
        details.entryLimitReached = effectiveLimit
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
        details.truncation = truncation
      }
      if (omitted) notices.push(omitted)
      if (notices.length > 0) text += `\n\n[${notices.join('. ')}]`
      return { content: [{ type: 'text', text }], details: Object.keys(details).length > 0 ? details : undefined }
    },
  }
}
