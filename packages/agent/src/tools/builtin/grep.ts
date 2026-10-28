// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { readFile, stat } from 'node:fs/promises'
import { basename, relative, sep } from 'node:path'
import ignore from 'ignore'
import { Type, type Static } from 'typebox'
import { resolveToCwd, throwIfAborted } from '../paths.ts'
import { DEFAULT_MAX_BYTES, formatSize, GREP_MAX_LINE_LENGTH, truncateHead, truncateLine, type TruncationResult } from '../truncate.ts'
import type { CokoTool } from '../types.ts'
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
      matches.push({ filePath, lineNumber: index + 1, lineText: line })
      if (matches.length >= request.limit) return true
    }
    return false
  }

  if (!request.isDirectory) {
    return { matches, limitReached: await searchFile(request.searchPath) }
  }
  const filter = createGlobFilter(request.glob)
  for await (const entry of walkTree(request.searchPath, { signal: request.signal, descend: (dir) => filter.directory(dir.relativePath) })) {
    if (entry.isDirectory || !filter.file(entry.relativePath)) continue
    throwIfAborted(request.signal)
    if (await searchFile(entry.absolutePath)) return { matches, limitReached: true }
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
    async execute(_toolCallId, params, signal) {
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

      const { matches, limitReached } = await searcher({
        pattern: params.pattern,
        searchPath,
        isDirectory,
        ...(params.glob ? { glob: params.glob } : {}),
        ignoreCase: params.ignoreCase === true,
        literal: params.literal === true,
        limit,
        ...(signal ? { signal } : {}),
      })
      throwIfAborted(signal)
      if (matches.length === 0) return { content: [{ type: 'text', text: 'No matches found' }], details: undefined }

      const formatPath = (filePath: string) => {
        if (isDirectory) {
          const rel = relative(searchPath, filePath)
          if (rel && !rel.startsWith('..')) return sep === '/' ? rel : rel.split(sep).join('/')
        }
        return basename(filePath)
      }
      const fileLines = new Map<string, string[]>()
      const linesOf = async (filePath: string) => {
        let lines = fileLines.get(filePath)
        if (!lines) {
          try {
            lines = (await readFile(filePath, 'utf-8')).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
          } catch {
            lines = []
          }
          fileLines.set(filePath, lines)
        }
        return lines
      }

      let linesTruncated = false
      const clip = (line: string) => {
        const { text, wasTruncated } = truncateLine(line.replace(/\r?\n$/, '').replace(/\r/g, ''))
        if (wasTruncated) linesTruncated = true
        return text
      }
      const output: string[] = []
      for (const match of matches) {
        const rel = formatPath(match.filePath)
        if (contextLines === 0 && match.lineText !== undefined) {
          output.push(`${rel}:${match.lineNumber}: ${clip(match.lineText)}`)
          continue
        }
        const lines = await linesOf(match.filePath)
        if (lines.length === 0) {
          output.push(`${rel}:${match.lineNumber}: (unable to read file)`)
          continue
        }
        const start = Math.max(1, match.lineNumber - contextLines)
        const end = Math.min(lines.length, match.lineNumber + contextLines)
        for (let current = start; current <= end; current++) {
          const text = clip(lines[current - 1] ?? '')
          output.push(current === match.lineNumber ? `${rel}:${current}: ${text}` : `${rel}-${current}- ${text}`)
        }
      }

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
      if (notices.length > 0) text += `\n\n[${notices.join('. ')}]`
      return { content: [{ type: 'text', text }], details: Object.keys(details).length > 0 ? details : undefined }
    },
  }
}
