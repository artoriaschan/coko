// 指令文件的加载（docs/subsystems/instructions.md）：用户级 → 仓库根 → … → Workspace（开始时），子目录按需（nested）；
// @import 最多 5 层、按真实路径防环、只在允许的根内；项目与嵌套指令文件的真实路径须在仓库根（没有仓库时为 Workspace）之内；
// Read 拒绝规则覆盖的文件不加载；单文件与合计预算。
import { dirname } from 'node:path'
import { isProtectedPath } from '../../policy/decide.ts'
import { pathContains } from '../../policy/rules.ts'
import { createMtimeCache, diagnostic, type ResourceDiagnostic } from '../shared/index.ts'
import { directoryChain, findRepoRoot, pickInstructionFile } from './discover.ts'
import type { InstructionFiles } from './files.ts'
import { extractImports, isTextPath, resolveImport } from './imports.ts'

export const INSTRUCTION_FILE_MAX_CHARS = 40_000
export const INSTRUCTIONS_TOTAL_MAX_CHARS = 120_000
export const MAX_IMPORT_DEPTH = 5

export type InstructionScope = 'user' | 'project' | 'nested'

export interface InstructionFile {
  /** 绝对路径（目录链或 @import 解析出的路径，不解析符号链接）。 */
  path: string
  scope: InstructionScope
  /** 进入上下文的文本（被截断时含截断说明）。 */
  content: string
  /** content 的字符数。 */
  chars: number
  truncated: boolean
  /** 经 @import 引入时为引入它的文件。 */
  importedBy?: string
}

export interface LoadedInstructions {
  /** 按进入上下文的顺序：越靠后越优先；被引入的文件在引入它的文件之前。 */
  files: InstructionFile[]
  diagnostics: ResourceDiagnostic[]
  totalChars: number
}

/** 路径是否被 Read 拒绝规则覆盖（按词法路径与真实路径各判定一次）；省略时没有规则。 */
export type InstructionDenial = (path: string) => boolean

export interface InstructionLoader {
  /** Run 开始时的指令：用户级与仓库根到 Workspace 的目录链（含 @import）。 */
  load(input: { cwd: string; cokoHome: string; denied?: InstructionDenial }): Promise<LoadedInstructions>
  /**
   * Workspace 根之下、到 targetDir（含）为止的目录链上的指令（scope nested）；loaded 中的文件（及其真实路径）跳过。
   * targetDir 不在 Workspace 之内或就是 Workspace 根时为空。
   */
  nested(input: { cwd: string; cokoHome: string; targetDir: string; loaded: ReadonlySet<string>; denied?: InstructionDenial }): Promise<LoadedInstructions>
}

interface Parsed {
  content: string
  truncated: boolean
  imports: string[]
}

function parse(text: string): Parsed {
  const truncated = text.length > INSTRUCTION_FILE_MAX_CHARS
  const kept = truncated ? text.slice(0, INSTRUCTION_FILE_MAX_CHARS) : text
  const content = truncated
    ? kept + '\n\n[truncated: this file has ' + text.length + ' characters; only the first ' + INSTRUCTION_FILE_MAX_CHARS + ' are included]'
    : kept
  // 被截断丢掉的部分中的 @import 不展开（模型看不到它们）。
  return { content, truncated, imports: extractImports(kept) }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

interface Walk {
  seen: Set<string>
  files: InstructionFile[]
  diagnostics: ResourceDiagnostic[]
  /** @import 允许的根：仓库根（没有仓库时为 Workspace）与 COKO_HOME。 */
  lexicalRoots: string[]
  realRoots: string[]
  /** 项目与嵌套指令文件允许的真实根：仓库根（没有仓库时为 Workspace）。 */
  projectRoot: string
  denied: InstructionDenial
}

export function createInstructionLoader(options: { files: InstructionFiles; homeDir: string }): InstructionLoader {
  const { files, homeDir } = options
  const cache = createMtimeCache(files, parse)
  const report = (walk: Walk, code: string, message: string, path?: string) => walk.diagnostics.push(diagnostic('instructions', code, message, path))

  async function visit(walk: Walk, path: string, scope: InstructionScope, depth: number, ancestors: readonly string[], importedBy?: string) {
    let real: string
    try {
      real = await files.realpath(path)
    } catch (error) {
      report(walk, 'read-failed', 'Could not read instruction file: ' + errorMessage(error), path)
      return
    }
    if (walk.seen.has(real)) return
    // 目录链上的文件（不是 import）：项目与嵌套作用域经符号链接越出仓库根时不读；用户级是用户自己的目录，不限制。
    if (importedBy === undefined && scope !== 'user' && !pathContains(walk.projectRoot, real)) {
      report(walk, 'file-outside-boundary', 'Instruction file resolves outside the repository root: ' + real, path)
      return
    }
    if (importedBy === undefined && (walk.denied(path) || walk.denied(real))) {
      report(walk, 'file-denied', 'Instruction file is denied by a Read permission rule', path)
      return
    }
    walk.seen.add(real)
    let parsed: Parsed | undefined
    try {
      parsed = await cache.load(real)
    } catch (error) {
      report(walk, 'read-failed', 'Could not read instruction file: ' + errorMessage(error), path)
      return
    }
    if (!parsed) return
    if (parsed.truncated) report(walk, 'file-truncated', 'Instruction file exceeds ' + INSTRUCTION_FILE_MAX_CHARS + ' characters and was truncated', path)
    for (const token of parsed.imports) {
      const target = resolveImport(token, dirname(path), homeDir)
      if (!walk.lexicalRoots.some((root) => pathContains(root, target))) {
        report(walk, 'import-outside-boundary', 'Import @' + token + ' is outside the repository root and COKO_HOME: ' + target, path)
        continue
      }
      const stat = await files.stat(target).catch(() => undefined)
      if (stat?.kind !== 'file') {
        report(walk, 'import-not-found', 'Import @' + token + ' not found: ' + target, path)
        continue
      }
      if (isProtectedPath({ resolved: target, real: target })) {
        report(walk, 'import-protected', 'Import @' + token + ' is a protected path (version control, editor or shell configuration): ' + target, path)
        continue
      }
      if (!isTextPath(target)) {
        report(walk, 'import-not-text', 'Import @' + token + ' is not a text file: ' + target, path)
        continue
      }
      const targetReal = await files.realpath(target)
      if (!walk.realRoots.some((root) => pathContains(root, targetReal))) {
        report(walk, 'import-outside-boundary', 'Import @' + token + ' resolves outside the repository root and COKO_HOME: ' + targetReal, path)
        continue
      }
      if (isProtectedPath({ resolved: target, real: targetReal })) {
        report(walk, 'import-protected', 'Import @' + token + ' resolves to a protected path: ' + targetReal, path)
        continue
      }
      if (walk.denied(target) || walk.denied(targetReal)) {
        report(walk, 'import-denied', 'Import @' + token + ' is denied by a Read permission rule: ' + target, path)
        continue
      }
      if (targetReal === real || ancestors.includes(targetReal)) {
        report(walk, 'import-cycle', 'Import @' + token + ' forms a cycle: ' + target, path)
        continue
      }
      if (walk.seen.has(targetReal)) continue
      if (depth + 1 > MAX_IMPORT_DEPTH) {
        report(walk, 'import-depth-exceeded', 'Import @' + token + ' exceeds the maximum depth of ' + MAX_IMPORT_DEPTH + ': ' + target, path)
        continue
      }
      await visit(walk, target, scope, depth + 1, [...ancestors, real], path)
    }
    if (parsed.content.trim().length === 0) return
    walk.files.push({
      path,
      scope,
      content: parsed.content,
      chars: parsed.content.length,
      truncated: parsed.truncated,
      ...(importedBy === undefined ? {} : { importedBy }),
    })
  }

  async function visitDirectory(walk: Walk, dir: string, scope: InstructionScope) {
    let file: string | undefined
    try {
      file = await pickInstructionFile(files, dir)
    } catch (error) {
      report(walk, 'read-failed', 'Could not list directory: ' + errorMessage(error), dir)
      return
    }
    if (file) await visit(walk, file, scope, 0, [])
  }

  async function walkFor(cwd: string, cokoHome: string, denied: InstructionDenial | undefined): Promise<{ walk: Walk; repoRoot: string | undefined }> {
    const repoRoot = await findRepoRoot(files, cwd, homeDir)
    const lexicalRoots = [repoRoot ?? cwd, ...(cokoHome ? [cokoHome] : [])]
    const realRoots = await Promise.all(lexicalRoots.map((root) => files.realpath(root)))
    return {
      walk: { seen: new Set(), files: [], diagnostics: [], lexicalRoots, realRoots, projectRoot: realRoots[0]!, denied: denied ?? (() => false) },
      repoRoot,
    }
  }

  const total = (list: readonly InstructionFile[]) => list.reduce((sum, file) => sum + file.chars, 0)

  return {
    async load({ cwd, cokoHome, denied }) {
      const { walk, repoRoot } = await walkFor(cwd, cokoHome, denied)
      if (cokoHome) await visitDirectory(walk, cokoHome, 'user')
      for (const dir of repoRoot ? directoryChain(repoRoot, cwd) : [cwd]) await visitDirectory(walk, dir, 'project')
      // 合计超出时从最远处（最前面）整文件丢弃。
      const kept = [...walk.files]
      while (kept.length > 0 && total(kept) > INSTRUCTIONS_TOTAL_MAX_CHARS) {
        const dropped = kept.shift()!
        report(walk, 'budget-exceeded', 'Instructions exceed ' + INSTRUCTIONS_TOTAL_MAX_CHARS + ' characters in total; this file was left out', dropped.path)
      }
      return { files: kept, diagnostics: walk.diagnostics, totalChars: total(kept) }
    },
    async nested({ cwd, cokoHome, targetDir, loaded, denied }) {
      if (targetDir === cwd || !pathContains(cwd, targetDir)) return { files: [], diagnostics: [], totalChars: 0 }
      const { walk } = await walkFor(cwd, cokoHome, denied)
      // 嵌套指令只来自 Workspace 之内（真实路径）。
      walk.projectRoot = await files.realpath(cwd)
      for (const path of loaded) walk.seen.add(await files.realpath(path))
      for (const dir of directoryChain(cwd, targetDir).slice(1)) await visitDirectory(walk, dir, 'nested')
      return { files: walk.files, diagnostics: walk.diagnostics, totalChars: total(walk.files) }
    },
  }
}
