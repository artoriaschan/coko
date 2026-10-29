// <available_skills> system section（M3 规格"预算与数值"）：每项 name、description 与 SKILL.md 绝对路径；disable-model-invocation 的不列。
// 合计不超过 8000 字符：放不下时前面的完整列出、尾部只列名字并注明数量；名字也放不下时注明其余的数量（参照 claude-code 的 skill 列表预算）。
import type { SystemSection } from '../../engine/types.ts'
import type { Skill } from './types.ts'

export const SKILLS_SECTION_BUDGET = 8000
export const SKILLS_SECTION_NAME = 'skills'

const OPEN = '<available_skills>'
const CLOSE = '</available_skills>'
const HEADER =
  "The following skills provide specialized instructions for specific tasks. When a task matches a skill's description, call the " +
  'skill tool with its name to load its instructions and the list of its bundled files before acting. Resolve relative paths in a ' +
  'skill against its base directory. The user can also invoke a skill explicitly as /<name>.'

export const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const entry = (skill: Skill) =>
  `<skill>\n<name>${escapeXml(skill.name)}</name>\n<description>${escapeXml(skill.description)}</description>\n<location>${escapeXml(skill.path)}</location>\n</skill>`

/** 组成索引；没有可列的 Skill 时 undefined（不注入）。skills 按优先级顺序给出（发现顺序）。 */
export function skillsSection(skills: readonly Skill[], budget = SKILLS_SECTION_BUDGET): SystemSection | undefined {
  const visible = skills.filter((s) => !s.disableModelInvocation)
  if (visible.length === 0) return undefined
  const entries = visible.map(entry)
  const names = visible.map((s) => escapeXml(s.name))
  const build = (full: number, tail?: string) => [OPEN, HEADER, ...entries.slice(0, full), ...(tail === undefined ? [] : [tail]), CLOSE].join('\n')
  const done = (text: string): SystemSection => ({ name: SKILLS_SECTION_NAME, text })

  if (build(entries.length).length <= budget) return done(build(entries.length))
  // 只放完整条目时最多放得下几个；再逐个让出位置给尾部的名字列表。
  let fit = 0
  let length = build(0).length
  while (fit < entries.length && length + entries[fit]!.length + 1 <= budget) length += entries[fit++]!.length + 1
  for (let full = fit; full >= 0; full--) {
    const rest = names.slice(full)
    const text = build(full, `${rest.length} more skills listed by name only: ${rest.join(', ')}`)
    if (text.length <= budget) return done(text)
  }
  // 名字也放不下：列出放得下的名字，注明其余的数量。
  const tail = (shown: number) =>
    shown === 0
      ? `${names.length} more skills not listed.`
      : `${shown} skills listed by name only: ${names.slice(0, shown).join(', ')}; ${names.length - shown} more skills not listed.`
  let shown = 0
  while (shown < names.length && build(0, tail(shown + 1)).length <= budget) shown++
  return done(build(0, tail(shown)))
}
