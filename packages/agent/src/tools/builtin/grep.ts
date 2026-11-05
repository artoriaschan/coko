// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { readFile, stat } from 'node:fs/promises'
import { basename, relative, sep } from 'node:path'
import ignore from 'ignore'
import { Type, type Static } from 'typebox'
import { resolveToCwd, throwIfAborted } from '../paths.ts'
import { DEFAULT_MAX_BYTES, formatSize, GREP_MAX_LINE_LENGTH, truncateHead, truncateLine, type TruncationResult } from '../truncate.ts'
import { ToolOutputBuffer } from '../output.ts'
import type { CokoTool } from '../types.ts'
import { createReadFilter } from './read-filter.ts'
import { walkTree } from './walk.ts'

export const grepParameters = Type.Object({
  pattern: Type.String({ description: 'Search pattern (regex or literal string)' }),
  path: Type.Optional(Type.String({ description: 'Directory or file to search (default: current directory)' })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive search (default: false)' })),
  literal: Type.Optional(Type.Boolean({ description: 'Treat pattern as literal string instead of regex (default: false)' })),
  context: Type.Optional(Type.Number({ description: 'Number of lines to show before and after each match (default: 0)' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of matches to return (default: 100)' })),
})

export type GrepParams = Static<typeof grepParameters>

export const GREP_DEFAULT_LIMIT = 100

export interface GrepToolDetails {
  truncation?: TruncationResult
  matchLimitReached?: number
  linesTruncated?: boolean
}

export interface GrepSearchRequest {
  pattern: string
  /** Absolute file or directory. */
  searchPath: string
  isDirectory: boolean
  glob?: string
  ignoreCase: boolean
  literal: boolean
  /** Stop after this many matching lines. */
  limit: number
  signal?: AbortSignal
  /** Stream matches to the formatter without retaining a second unbounded match array. False stops capture. */
  consume?: (match: GrepMatch) => Promise<boolean>
}

export interface GrepMatch {
  /** Absolute path of the file. */
  filePath: string
  /** 1-based line number. */
  lineNumber: number
  /** Text of the matching line, if the searcher has it; line terminators are stripped by the tool. */
  lineText?: string
}

export interface GrepSearchResult {
  /** Matching lines in path order, then line order. */
  matches: GrepMatch[]
  limitReached: boolean
}

/**
 * Search backend of the grep tool. The built-in searcher is pure JS; hosts can provide another
 * (ripgrep) and keep the tool contract and output format by building the tool with
 * `createGrepTool({ cwd, searcher })`.
 *
 * Required semantics: honor .gitignore / .ignore / .rgignore (also outside git repositories),
 * include hidden files, skip `.git`, skip binary files (NUL byte), visit files sorted by path,
 * apply `glob` with gitignore syntax relative to `searchPath` (a leading `!` excludes),
 * count one match per line, and reject on an invalid pattern.
 */
export type GrepSearcher = (request: GrepSearchRequest) => Promise<GrepSearchResult>

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function createGlobFilter(glob: string | undefined) {
  if (!glob) return { file: () => true, directory: () => true }
  const negative = glob.startsWith('!')
  const matcher = ignore().add(negative ? glob.slice(1) : glob)
  return {
    file: (rel: string) => matcher.ignores(rel) !== negative,
    directory: (rel: string) => !(negative && matcher.ignores(`${rel}/`)),
  }
}

/** Pure-JS searcher used by the built-in grep. */
export const jsGrepSearcher: GrepSearcher = async (request) => {
  const source = request.literal ? escapeRegExp(request.pattern) : request.pattern
  const regex = new RegExp(source, request.ignoreCase ? 'i' : '')
  const matches: GrepMatch[] = []
  let count = 0
  let limitReached = false

  const searchFile = async (filePath: string): Promise<boolean> => {
    let buffer: Buffer
    try {
      buffer = await readFile(filePath)
    } catch {
      return false
    }
    if (buffer.includes(0)) return false
    const lines = buffer.toString('utf-8').split('\n')
    if (lines.at(-1) === '') lines.pop()
    for (let index = 0; index < lines.length; index++) {
      const line = (lines[index] as string).replace(/\r$/, '')
      if (!regex.test(line)) continue
      throwIfAborted(request.signal)
      const match = { filePath, lineNumber: index + 1, lineText: line }
      count++
      limitReached = count >= request.limit
      if (request.consume) {
        if (!(await request.consume(match))) return true
      } else matches.push(match)
      if (limitReached) return true
    }
    return false
  }

  if (!request.isDirectory) {
    await searchFile(request.searchPath)
    return { matches, limitReached }
  }
  const filter = createGlobFilter(request.glob)
  for await (const entry of walkTree(request.searchPath, { signal: request.signal, descend: (dir) => filter.directory(dir.relativePath) })) {
    if (entry.isDirectory || !filter.file(entry.relativePath)) continue
    throwIfAborted(request.signal)
    if (await searchFile(entry.absolutePath)) return { matches, limitReached }
  }
  return { matches, limitReached: false }
}

export interface GrepToolOptions {
  cwd: string
  searcher?: GrepSearcher
}

export function createGrepTool({ cwd, searcher = jsGrepSearcher }: GrepToolOptions): CokoTool<typeof grepParameters, GrepToolDetails | undefined> {
  return {
    name: 'grep',
    label: 'grep',
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${GREP_DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
    parameters: grepParameters,
    effect: 'read',
    permissionSubject: (args) => args.path ?? '.',
    async execute(_toolCallId, params, signal, _onUpdate, context) {
      throwIfAborted(signal)
      const searchPath = resolveToCwd(params.path || '.', cwd)
      let isDirectory: boolean
      try {
        isDirectory = (await stat(searchPath)).isDirectory()
      } catch {
        throw new Error(`Path not found: ${searchPath}`)
      }
      const contextLines = params.context && params.context > 0 ? Math.floor(params.context) : 0
      const limit = Math.max(1, Math.floor(params.limit ?? GREP_DEFAULT_LIMIT))

      const filter = await createReadFilter(context, searchPath)
      const formatPath = (filePath: string) => {
        if (isDirectory) {
          const rel = relative(searchPath, filePath)
          if (rel && !rel.startsWith('..')) return sep === '/' ? rel : rel.split(sep).join('/')
        }
        return basename(filePath)
      }
      // Backends visit files in path order, so only the current context file needs caching.
      let cachedPath: string | undefined
      let cachedLines: string[] = []
      const linesOf = async (filePath: string) => {
        if (cachedPath !== filePath) {
          try {
            cachedLines = (await readFile(filePath, 'utf-8')).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
          } catch {
            cachedLines = []
          }
          cachedPath = filePath
        }
        return cachedLines
      }

      let linesTruncated = false
      const clip = (line: string) => {
        const { text, wasTruncated } = truncateLine(line.replace(/\r?\n$/, '').replace(/\r/g, ''))
        if (wasTruncated) linesTruncated = true
        return text
      }
      const output: string[] = []
      const fullOutput = new ToolOutputBuffer(context?.outputRedaction)
      let matchCount = 0
      let consumed = false
      const deniedFiles = new Set<string>()
      const collect = async (match: GrepMatch): Promise<boolean> => {
        if (deniedFiles.has(match.filePath)) return true
        if (filter.denied(match.filePath)) {
          deniedFiles.add(match.filePath)
          return true
        }
        matchCount++
        const visible = matchCount <= limit
        const rel = formatPath(match.filePath)
        if (contextLines === 0 && match.lineText !== undefined) {
          const active = fullOutput.appendLine(`${rel}:${match.lineNumber}: ${match.lineText.replace(/\r?\n$/, '').replace(/\r/g, '')}`)
          if (visible) output.push(`${rel}:${match.lineNumber}: ${clip(match.lineText)}`)
          // Filling the spill buffer must not shorten the independent preview window.
          return active || matchCount < limit
        }
        const lines = await linesOf(match.filePath)
        if (lines.length === 0) {
          if (visible) output.push(`${rel}:${match.lineNumber}: (unable to read file)`)
          return fullOutput.appendLine(`${rel}:${match.lineNumber}: (unable to read file)`) || matchCount < limit
        }
        const start = Math.max(1, match.lineNumber - contextLines)
        const end = Math.min(lines.length, match.lineNumber + contextLines)
        let captureActive = true
        for (let current = start; current <= end; current++) {
          const original = (lines[current - 1] ?? '').replace(/\r/g, '')
          captureActive = fullOutput.appendLine(current === match.lineNumber ? `${rel}:${current}: ${original}` : `${rel}-${current}- ${original}`)
          if (visible) {
            const text = clip(original)
            output.push(current === match.lineNumber ? `${rel}:${current}: ${text}` : `${rel}-${current}- ${text}`)
          }
          if (!captureActive && !visible) return false
        }
        return captureActive || matchCount < limit
      }
      const searched = await searcher({
        pattern: params.pattern,
        searchPath,
        isDirectory,
        ...(params.glob ? { glob: params.glob } : {}),
        ignoreCase: params.ignoreCase === true,
        literal: params.literal === true,
        // Explicit limits are query bounds. The default is a display cap; retain its overflow.
        limit: params.limit === undefined ? Number.MAX_SAFE_INTEGER : limit,
        ...(signal ? { signal } : {}),
        consume: async (match) => {
          consumed = true
          return collect(match)
        },
      })
      // Existing custom searchers may still return their result array rather than use consume.
      if (!consumed) for (const match of searched.matches) if (!(await collect(match))) break
      throwIfAborted(signal)
      const limitReached = params.limit === undefined ? matchCount > limit : searched.limitReached
      const omitted = filter.notice()
      if (matchCount === 0) return { content: [{ type: 'text', text: omitted ? `No matches found\n\n[${omitted}]` : 'No matches found' }], details: undefined }

      const truncation = truncateHead(output.join('\n'), { maxLines: Number.MAX_SAFE_INTEGER })
      let text = truncation.content
      const details: GrepToolDetails = {}
      const notices: string[] = []
      if (limitReached) {
        notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`)
        details.matchLimitReached = limit
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`)
        details.truncation = truncation
      }
      if (linesTruncated) {
        notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`)
        details.linesTruncated = true
      }
      if (omitted) notices.push(omitted)
      if (notices.length > 0) text += `\n\n[${notices.join('. ')}]`
      return {
        content: [{ type: 'text', text }],
        details: Object.keys(details).length > 0 ? details : undefined,
        ...(truncation.truncated || linesTruncated || (params.limit === undefined && limitReached) ? fullOutput.result() : {}),
      }
    },
  }
}
