// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { stat } from 'node:fs/promises'
import { Type } from 'typebox'
import { resolveToCwd, throwIfAborted } from '../paths.ts'
import { DEFAULT_MAX_BYTES, formatSize, truncateHead, type TruncationResult } from '../truncate.ts'
import { ToolOutputBuffer } from '../output.ts'
import type { CokoTool } from '../types.ts'
import { createFindMatcher } from './glob.ts'
import { createReadFilter } from './read-filter.ts'
import { walkTree } from './walk.ts'

export const findParameters = Type.Object({
  pattern: Type.String({ description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'" }),
  path: Type.Optional(Type.String({ description: 'Directory to search in (default: current directory)' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of results (default: 1000)' })),
})

const DEFAULT_LIMIT = 1000

export interface FindToolDetails {
  truncation?: TruncationResult
  resultLimitReached?: number
}

export function createFindTool({ cwd }: { cwd: string }): CokoTool<typeof findParameters, FindToolDetails | undefined> {
  return {
    name: 'find',
    label: 'find',
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: findParameters,
    effect: 'read',
    permissionSubject: (args) => args.path ?? '.',
    async execute(_toolCallId, { pattern, path, limit }, signal, _onUpdate, context) {
      throwIfAborted(signal)
      const searchPath = resolveToCwd(path || '.', cwd)
      try {
        if (!(await stat(searchPath)).isDirectory()) throw new Error('not a directory')
      } catch {
        throw new Error(`Path not found: ${searchPath}`)
      }
      const effectiveLimit = limit ?? DEFAULT_LIMIT
      const matches = createFindMatcher(pattern)
      const results: string[] = []
      const fullOutput = new ToolOutputBuffer(context?.outputRedaction)
      const filter = await createReadFilter(context, searchPath)
      // 被读取拒绝规则覆盖的目录不进入，文件不列出。
      let resultLimitReached = false
      const denied = new Set<string>()
      const descend = (entry: { absolutePath: string }) => !denied.has(entry.absolutePath)
      for await (const entry of walkTree(searchPath, { ...(signal ? { signal } : {}), descend })) {
        if (filter.denied(entry.absolutePath)) {
          denied.add(entry.absolutePath)
          continue
        }
        if (!matches(entry.relativePath)) continue
        const line = entry.isDirectory ? `${entry.relativePath}/` : entry.relativePath
        if (results.length < effectiveLimit) results.push(line)
        else resultLimitReached = true
        if (!fullOutput.appendLine(line)) break
        if (limit !== undefined && results.length >= effectiveLimit) {
          resultLimitReached = true
          break
        }
      }
      throwIfAborted(signal)
      const omitted = filter.notice()
      if (results.length === 0)
        return {
          content: [{ type: 'text', text: omitted ? `No files found matching pattern\n\n[${omitted}]` : 'No files found matching pattern' }],
          details: undefined,
        }

      const truncation = truncateHead(results.join('\n'), { maxLines: Number.MAX_SAFE_INTEGER })
      let text = truncation.content
      const details: FindToolDetails = {}
      const notices: string[] = []
      if (resultLimitReached) {
        notices.push(`${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`)
        details.resultLimitReached = effectiveLimit
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
        details.truncation = truncation
      }
      if (omitted) notices.push(omitted)
      if (notices.length > 0) text += `\n\n[${notices.join('. ')}]`
      return {
        content: [{ type: 'text', text }],
        details: Object.keys(details).length > 0 ? details : undefined,
        ...(truncation.truncated || (limit === undefined && resultLimitReached) ? fullOutput.result() : {}),
      }
    },
  }
}
