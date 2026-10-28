// Adapted from pi coding-agent 1.4.0 (MIT, Copyright (c) 2025 Mario Zechner). See THIRD_PARTY_NOTICES.md.

import { constants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import { Type, type Static } from 'typebox'
import { resolveToCwd, throwIfAborted } from '../paths.ts'
import type { CokoTool } from '../types.ts'
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  generateDiffString,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  splitBom,
  type Edit,
} from './edit-diff.ts'
import { withFileMutationQueue } from './file-mutation-queue.ts'

const replaceEdit = Type.Object({
  oldText: Type.String({
    description:
      'Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.',
  }),
  newText: Type.String({ description: 'Replacement text for this targeted edit.' }),
})

export const editParameters = Type.Object({
  path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
  edits: Type.Array(replaceEdit, {
    description:
      'One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.',
  }),
})

export type EditParams = Static<typeof editParameters>

export interface EditToolDetails {
  /** Display diff with line numbers. */
  diff: string
  /** Standard unified patch. */
  patch: string
  /** First changed line in the new file. */
  firstChangedLine?: number
}

const isSingleEdit = (value: unknown): value is Edit =>
  !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Edit).oldText === 'string' && typeof (value as Edit).newText === 'string'

/** Accept common model variants: `edits` as a JSON string or single object, and legacy top-level oldText/newText. */
function prepareEditArguments(input: unknown): EditParams {
  if (!input || typeof input !== 'object') return input as EditParams
  const args = { ...(input as Record<string, unknown>) }
  if (typeof args.edits === 'string') {
    try {
      const parsed: unknown = JSON.parse(args.edits)
      if (Array.isArray(parsed)) args.edits = parsed
      else if (isSingleEdit(parsed)) args.edits = [parsed]
    } catch {
      // Leave it for schema validation to report.
    }
  } else if (isSingleEdit(args.edits)) {
    args.edits = [args.edits]
  }
  if (typeof args.oldText !== 'string' || typeof args.newText !== 'string') return args as EditParams
  const edits = Array.isArray(args.edits) ? [...args.edits] : []
  edits.push({ oldText: args.oldText, newText: args.newText })
  const { oldText: _oldText, newText: _newText, ...rest } = args
  return { ...rest, edits } as EditParams
}

/** edits 能否作用于 text（与 execute 相同的匹配规则：唯一、不重叠、有变化）。 */
function applies(text: string, edits: Edit[]): boolean {
  try {
    applyEditsToNormalizedContent(text, edits, '')
    return true
  } catch {
    return false
  }
}

/**
 * 恢复：文件只能按"旧 → 新"套用时尚未生效；只能按"新 → 旧"反向套用时已生效；两个方向都成立（新文本包含旧文本等）、
 * 都不成立或文件不可读时无法判定。含删除（新文本为空）的调用不做反向套用：只有正向成立（旧文本仍在）能下结论。
 */
async function probeEdit({ path, edits }: EditParams, cwd: string): Promise<'applied' | 'not-applied' | 'unknown'> {
  if (!Array.isArray(edits) || edits.length === 0) return 'unknown'
  let raw: string
  try {
    raw = (await readFile(resolveToCwd(path, cwd))).toString('utf-8')
  } catch {
    return 'unknown'
  }
  const text = normalizeToLF(splitBom(raw).text)
  const forward = applies(text, edits)
  const reversible = edits.every((e) => e.newText !== '')
  const backward =
    reversible &&
    applies(
      text,
      edits.map((e) => ({ oldText: e.newText, newText: e.oldText })),
    )
  if (forward && !backward) return 'not-applied'
  if (backward && !forward) return 'applied'
  return 'unknown'
}

export function createEditTool({ cwd }: { cwd: string }): CokoTool<typeof editParameters, EditToolDetails | undefined> {
  return {
    name: 'edit',
    label: 'edit',
    description:
      'Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.',
    parameters: editParameters,
    effect: 'side-effect',
    permissionSubject: (args) => args.path,
    prepareArguments: prepareEditArguments,
    probeOutcome: probeEdit,
    async execute(_toolCallId, { path, edits }, signal) {
      if (!Array.isArray(edits) || edits.length === 0) throw new Error('Edit tool input is invalid. edits must contain at least one replacement.')
      const absolutePath = resolveToCwd(path, cwd)
      return withFileMutationQueue(absolutePath, async () => {
        throwIfAborted(signal)
        try {
          await access(absolutePath, constants.R_OK | constants.W_OK)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          throw new Error(`Could not edit file: ${path}. ${code ? `Error code: ${code}` : String(error)}.`)
        }
        const raw = (await readFile(absolutePath)).toString('utf-8')
        throwIfAborted(signal)
        const { bom, text } = splitBom(raw)
        const ending = detectLineEnding(text)
        const { baseContent, newContent } = applyEditsToNormalizedContent(normalizeToLF(text), edits, path)
        throwIfAborted(signal)
        await writeFile(absolutePath, bom + restoreLineEndings(newContent, ending), 'utf-8')
        const diff = generateDiffString(baseContent, newContent)
        return {
          content: [{ type: 'text', text: `Successfully replaced ${edits.length} block(s) in ${path}.` }],
          details: {
            diff: diff.diff,
            patch: generateUnifiedPatch(path, baseContent, newContent),
            ...(diff.firstChangedLine === undefined ? {} : { firstChangedLine: diff.firstChangedLine }),
          },
        }
      })
    },
  }
}
