// 发现提示模板：<root>/**/*.md，子目录以 `:` 拼名；frontmatter 只认 description 与 argument-hint（docs/subsystems/commands.md）。
// 读取失败或格式错误只产生诊断，不阻止 Run。做法参照 pi coding-agent 的 core/prompt-templates.ts（v1.4.0，MIT License）。
import { join } from 'node:path'
import { createMtimeCache, type MtimeCache } from '../shared/cache.ts'
import { diagnostic, type ResourceDiagnostic } from '../shared/diagnostics.ts'
import { createNodeFiles, type ReadOnlyFiles } from '../shared/files.ts'
import { parseFrontmatter } from '../shared/frontmatter.ts'
import { COMMAND_NAME_SEGMENT } from './args.ts'
import type { CommandTemplate } from './types.ts'

/** 目录递归的深度上限（防止符号链接成环）。 */
const MAX_DEPTH = 8
const DESCRIPTION_FALLBACK_CHARS = 60

type Parsed = { ok: true; description: string; argumentHint?: string; content: string; problems: string[] } | { ok: false; code: string; message: string }

function parseTemplate(text: string): Parsed {
  const result = parseFrontmatter(text)
  if (!result.ok) return { ok: false, code: 'invalid-frontmatter', message: `Invalid frontmatter: ${result.error}` }
  const content = result.body.trim()
  if (content === '') return { ok: false, code: 'empty-template', message: 'The command template has no content' }
  const problems: string[] = []
  const string = (key: string) => {
    const value = result.frontmatter[key]
    if (value === undefined || value === null) return undefined
    if (typeof value === 'string') return value.trim() || undefined
    problems.push(`Frontmatter key "${key}" must be a string; ignored`)
    return undefined
  }
  const declared = string('description')
  const argumentHint = string('argument-hint')
  let description = declared
  if (description === undefined) {
    const first = content
      .split('\n')
      .find((line) => line.trim() !== '')!
      .trim()
    description = first.length > DESCRIPTION_FALLBACK_CHARS ? `${first.slice(0, DESCRIPTION_FALLBACK_CHARS)}...` : first
  }
  return { ok: true, description, ...(argumentHint === undefined ? {} : { argumentHint }), content, problems }
}

export interface CommandTemplateLoadOptions {
  /** 插件的命令目录（ADR 0017）：命令以 <plugin>:<name> 登记（source 为 user），诊断的 source 为 plugin。 */
  plugin?: string
}

export interface CommandTemplateLoader {
  /** root 下的模板（按名字排序）与诊断；root 不存在时为空。文件未变（mtime 与大小）时复用上次的解析结果。 */
  load(
    root: string,
    source: CommandTemplate['source'],
    options?: CommandTemplateLoadOptions,
  ): Promise<{ templates: CommandTemplate[]; diagnostics: ResourceDiagnostic[] }>
}

export function createCommandTemplateLoader(files: ReadOnlyFiles = createNodeFiles()): CommandTemplateLoader {
  const cache: MtimeCache<Parsed> = createMtimeCache(files, parseTemplate)
  return {
    async load(root, source, options = {}) {
      const templates: CommandTemplate[] = []
      const diagnostics: ResourceDiagnostic[] = []
      const origin = options.plugin === undefined ? 'commands' : 'plugin'
      const prefix = options.plugin === undefined ? [] : [options.plugin]
      const visit = async (dir: string, segments: string[]) => {
        let entries
        try {
          entries = await files.list(dir)
        } catch (error) {
          diagnostics.push(diagnostic(origin, 'read-failed', `Cannot list directory: ${message(error)}`, dir))
          return
        }
        for (const entry of entries) {
          const path = join(dir, entry.name)
          if (entry.kind === 'directory') {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || segments.length >= MAX_DEPTH) continue
            await visit(path, [...segments, entry.name])
            continue
          }
          if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
          const parts = [...segments, entry.name.slice(0, -'.md'.length)]
          if (parts.some((part) => !COMMAND_NAME_SEGMENT.test(part))) {
            diagnostics.push(diagnostic(origin, 'invalid-name', `"${parts.join(':')}" is not a valid command name (letters, digits, ".", "_" and "-")`, path))
            continue
          }
          let parsed: Parsed | undefined
          try {
            parsed = await cache.load(path)
          } catch (error) {
            diagnostics.push(diagnostic(origin, 'read-failed', `Cannot read the command template: ${message(error)}`, path))
            continue
          }
          if (!parsed) continue
          if (!parsed.ok) {
            diagnostics.push(diagnostic(origin, parsed.code, parsed.message, path))
            continue
          }
          for (const problem of parsed.problems) diagnostics.push(diagnostic(origin, 'invalid-value', problem, path))
          templates.push({
            name: [...prefix, ...parts].join(':'),
            description: parsed.description,
            argumentHint: parsed.argumentHint,
            source,
            path,
            content: parsed.content,
          })
        }
      }
      const info = await files.stat(root).catch(() => undefined)
      if (info?.kind === 'directory') await visit(root, [])
      templates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      return { templates, diagnostics }
    },
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
