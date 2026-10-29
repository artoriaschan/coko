// 发现 Skill：每个位置中含 SKILL.md 的目录为一个 Skill 根，不再向下；跳过 . 开头的目录与 node_modules；按真实路径去重（指向同一目录的
// 符号链接只算一次，不记遮蔽）；同名时排在前面的位置优先，被遮蔽的记诊断 shadowed。SKILL.md 按 mtime 缓存。读取失败或不合规只产生诊断。
// 做法参照 pi coding-agent 的 core/skills.ts（v1.4.0，Copyright (c) 2025 Mario Zechner，MIT License）。
import { realpath as nodeRealpath } from 'node:fs/promises'
import { join } from 'node:path'
import { pathContains } from '../../policy/rules.ts'
import { createMtimeCache } from '../shared/cache.ts'
import { diagnostic, type ResourceDiagnostic } from '../shared/diagnostics.ts'
import { createNodeFiles, type ReadOnlyFiles } from '../shared/files.ts'
import { parseSkillFile, type SkillParseResult } from './parse.ts'
import type { Skill, SkillContent, SkillLocation } from './types.ts'

export const SKILL_FILE = 'SKILL.md'
/** skill 工具与 /<name> 展开列出的文件数上限。 */
export const SKILL_FILES_MAX = 50
/** 目录递归的深度上限（防止符号链接成环）。 */
const MAX_DEPTH = 8

const skipped = (name: string) => name.startsWith('.') || name === 'node_modules'
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export interface SkillDiscovery {
  /** 位置顺序、位置内按目录深度优先与名字排序。 */
  skills: Skill[]
  diagnostics: ResourceDiagnostic[]
}

export interface SkillLoader {
  discover(locations: readonly SkillLocation[]): Promise<SkillDiscovery>
  /** 重新读取（按 mtime 缓存）SKILL.md 的正文并列出 Skill 目录下的文件；SKILL.md 已不存在或不再合规时抛出。 */
  content(skill: Skill): Promise<SkillContent>
}

export interface SkillLoaderOptions {
  files?: ReadOnlyFiles
  /** 真实路径（去重用）；缺省 node:fs 的 realpath，失败时用原路径。 */
  realpath?: (path: string) => Promise<string>
}

export function createSkillLoader(options: SkillLoaderOptions = {}): SkillLoader {
  const files = options.files ?? createNodeFiles()
  const realpath = options.realpath ?? nodeRealpath
  const cache = createMtimeCache<SkillParseResult>(files, parseSkillFile)

  /** dir 下的 SKILL.md 路径（目录本身含 SKILL.md 时只有它）。 */
  async function findSkillFiles(dir: string, depth: number, diagnostics: ResourceDiagnostic[], root: boolean): Promise<string[]> {
    let entries
    try {
      entries = await files.list(dir)
    } catch (error) {
      diagnostics.push(diagnostic('skills', 'read-failed', `Cannot list directory: ${message(error)}`, dir))
      return []
    }
    // 位置目录本身不是 Skill 根（它的名字不是 Skill 名）。
    if (!root && entries.some((e) => e.name === SKILL_FILE && e.kind === 'file')) return [join(dir, SKILL_FILE)]
    if (depth >= MAX_DEPTH) return []
    const found: string[] = []
    for (const entry of entries) {
      if (entry.kind !== 'directory' || skipped(entry.name)) continue
      found.push(...(await findSkillFiles(join(dir, entry.name), depth + 1, diagnostics, false)))
    }
    return found
  }

  return {
    async discover(locations) {
      const skills: Skill[] = []
      const diagnostics: ResourceDiagnostic[] = []
      const seen = new Set<string>()
      const byName = new Map<string, Skill>()
      for (const location of locations) {
        const info = await files.stat(location.dir).catch(() => undefined)
        if (info?.kind !== 'directory') continue
        const boundary = location.boundary === undefined ? undefined : await realpath(location.boundary).catch(() => location.boundary!)
        for (const path of await findSkillFiles(location.dir, 0, diagnostics, true)) {
          const real = await realpath(path).catch(() => path)
          if (boundary !== undefined && !pathContains(boundary, real)) {
            diagnostics.push(diagnostic('skills', 'skill-outside-workspace', `Skill resolves outside the Workspace and was not loaded: ${real}`, path))
            continue
          }
          if (seen.has(real)) continue
          seen.add(real)
          let parsed: SkillParseResult | undefined
          try {
            parsed = await cache.load(path)
          } catch (error) {
            diagnostics.push(diagnostic('skills', 'read-failed', `Cannot read SKILL.md: ${message(error)}`, path))
            continue
          }
          if (!parsed) continue
          if (!parsed.ok) {
            diagnostics.push(diagnostic('skills', parsed.code, parsed.message, path))
            continue
          }
          const winner = byName.get(parsed.name)
          if (winner) {
            diagnostics.push(
              diagnostic('skills', 'shadowed', `Skill "${parsed.name}" (${location.scope}) is shadowed by ${winner.path} (${winner.scope})`, path),
            )
            continue
          }
          const skill: Skill = {
            name: parsed.name,
            description: parsed.description,
            path,
            baseDir: join(path, '..'),
            scope: location.scope,
            allowedTools: parsed.allowedTools,
            disableModelInvocation: parsed.disableModelInvocation,
            ...(parsed.argumentHint === undefined ? {} : { argumentHint: parsed.argumentHint }),
          }
          byName.set(skill.name, skill)
          skills.push(skill)
        }
      }
      return { skills, diagnostics }
    },

    async content(skill) {
      const parsed = await cache.load(skill.path)
      if (!parsed) throw new Error(`SKILL.md no longer exists: ${skill.path}`)
      if (!parsed.ok) throw new Error(`SKILL.md is no longer valid (${parsed.code}): ${parsed.message}`)
      const listed: string[] = []
      const visit = async (dir: string, prefix: string, depth: number) => {
        let entries
        try {
          entries = await files.list(dir)
        } catch {
          return
        }
        for (const entry of entries) {
          if (listed.length > SKILL_FILES_MAX) return
          if (skipped(entry.name) || (depth === 0 && entry.name === SKILL_FILE)) continue
          const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
          if (entry.kind === 'file') listed.push(relative)
          else if (entry.kind === 'directory' && depth < MAX_DEPTH) await visit(join(dir, entry.name), relative, depth + 1)
        }
      }
      await visit(skill.baseDir, '', 0)
      return { body: parsed.body, files: listed.slice(0, SKILL_FILES_MAX), filesTruncated: listed.length > SKILL_FILES_MAX }
    },
  }
}
