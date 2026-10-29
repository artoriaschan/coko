// SKILL.md 的 frontmatter 校验，按 Agent Skills 规范（https://agentskills.io/specification）：name 1–64 个 [a-z0-9-]、首尾不为连字符、
// 无连续连字符且等于目录名；description 1–1024；compatibility ≤ 500；metadata 为字符串映射；license、allowed-tools 可选。另接受
// claude-code / pi 的扩展 disable-model-invocation 与 argument-hint。不合规的不加载。做法参照 pi coding-agent 的 core/skills.ts（v1.4.0，MIT License）。
import { basename, dirname } from 'node:path'
import { parseFrontmatter } from '../shared/frontmatter.ts'

export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_MAX = 1024
export const SKILL_COMPATIBILITY_MAX = 500

export interface ParsedSkill {
  ok: true
  name: string
  description: string
  allowedTools: string[]
  disableModelInvocation: boolean
  argumentHint: string | undefined
  body: string
}

export type SkillParseResult = ParsedSkill | { ok: false; code: string; message: string }

const fail = (code: string, message: string): SkillParseResult => ({ ok: false, code, message })

function nameProblems(name: string): string[] {
  const problems: string[] = []
  if (name.length === 0 || name.length > SKILL_NAME_MAX) problems.push(`name must be 1-${SKILL_NAME_MAX} characters (got ${name.length})`)
  if (!/^[a-z0-9-]*$/.test(name)) problems.push('name may only contain lowercase letters, digits and hyphens')
  if (name.startsWith('-') || name.endsWith('-')) problems.push('name must not start or end with a hyphen')
  if (name.includes('--')) problems.push('name must not contain consecutive hyphens')
  return problems
}

const isStringMap = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === 'string')

function allowedTools(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value.map((v: string) => v.trim()).filter(Boolean)
  return undefined
}

/** 解析一个 SKILL.md（path 为其绝对路径，目录名用于 name 校验）。 */
export function parseSkillFile(text: string, path: string): SkillParseResult {
  const result = parseFrontmatter(text)
  if (!result.ok) return fail('invalid-frontmatter', `Invalid frontmatter: ${result.error}`)
  const f = result.frontmatter
  const dirName = basename(dirname(path))

  if (typeof f.name !== 'string') return fail('invalid-name', 'Frontmatter must declare a string name')
  const problems = nameProblems(f.name)
  if (problems.length > 0) return fail('invalid-name', `Invalid skill name "${f.name}": ${problems.join('; ')}`)
  if (f.name !== dirName) return fail('name-mismatch', `Skill name "${f.name}" must equal its directory name "${dirName}"`)

  if (typeof f.description !== 'string' || f.description.trim() === '') return fail('missing-description', 'Frontmatter must declare a non-empty description')
  const description = f.description.trim()
  if (description.length > SKILL_DESCRIPTION_MAX)
    return fail('description-too-long', `description exceeds ${SKILL_DESCRIPTION_MAX} characters (${description.length})`)

  if (f.compatibility !== undefined && (typeof f.compatibility !== 'string' || f.compatibility.length > SKILL_COMPATIBILITY_MAX))
    return fail('invalid-value', `compatibility must be a string of at most ${SKILL_COMPATIBILITY_MAX} characters`)
  if (f.metadata !== undefined && !isStringMap(f.metadata)) return fail('invalid-value', 'metadata must map string keys to string values')
  if (f.license !== undefined && typeof f.license !== 'string') return fail('invalid-value', 'license must be a string')
  const tools = allowedTools(f['allowed-tools'])
  if (!tools) return fail('invalid-value', 'allowed-tools must be a space-separated string or a list of strings')
  const disable = f['disable-model-invocation']
  if (disable !== undefined && typeof disable !== 'boolean') return fail('invalid-value', 'disable-model-invocation must be true or false')
  const hint = f['argument-hint']
  if (hint !== undefined && hint !== null && typeof hint !== 'string') return fail('invalid-value', 'argument-hint must be a string')

  return {
    ok: true,
    name: f.name,
    description,
    allowedTools: tools,
    disableModelInvocation: disable === true,
    argumentHint: typeof hint === 'string' && hint.trim() !== '' ? hint.trim() : undefined,
    body: result.body.trim(),
  }
}
