// skill 工具（模型调用一个 Skill）与 /<skill-name> 展开共用的 <skill …> 块。权限类由宿主注册时给出：context-read（所有模式放行），
// 规则名 Skill、判定对象为 Skill 名（Skill(pdf) 可 deny / ask）。
import { Type } from 'typebox'
import type { PermissionClass } from '../../policy/decide.ts'
import type { CokoTool } from '../../tools/types.ts'
import { SKILL_FILES_MAX, type SkillLoader } from './loader.ts'
import type { Skill, SkillContent } from './types.ts'

export const SKILL_TOOL_NAME = 'skill'

const attr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** <skill name location> 块：基目录、去掉 frontmatter 的正文与文件清单（参照 pi coding-agent v1.4.0 的 skill 展开）。 */
export function formatSkillBlock(skill: Skill, content: SkillContent): string {
  const lines = [
    `<skill name="${attr(skill.name)}" location="${attr(skill.path)}">`,
    `Base directory for this skill: ${skill.baseDir}`,
    'Relative paths in this skill are relative to the base directory.',
    '',
    content.body,
  ]
  if (content.files.length > 0) {
    lines.push('', '<skill_files>', ...content.files)
    if (content.filesTruncated) lines.push(`(file list truncated at ${SKILL_FILES_MAX} entries)`)
    lines.push('</skill_files>')
  }
  lines.push('</skill>')
  return lines.join('\n')
}

/** 用户以 /<name> 参数 调用：<skill> 块，参数原样附在其后（参照 pi）。disable-model-invocation 的 Skill 同样可以这样调用。 */
export function expandSkillInvocation(skill: Skill, content: SkillContent, args: string): string {
  const block = formatSkillBlock(skill, content)
  const text = args.trim()
  return text === '' ? block : `${block}\n\n${text}`
}

export const skillToolParameters = Type.Object({
  name: Type.String({ minLength: 1, description: 'Name of the skill, as listed in <available_skills>' }),
  args: Type.Optional(Type.String({ description: 'Optional arguments or context for the skill' })),
})

export interface SkillToolDetails {
  name: string
  path: string
  baseDir: string
  files: string[]
  filesTruncated: boolean
}

export interface SkillTool {
  tool: CokoTool
  permissionClass: PermissionClass
}

/**
 * skills 为本次 Run 可用（已启用）的 Skill；disable-model-invocation 的不能经工具调用。返回正文、基目录、文件清单（最多 50 项）与 args。
 */
export function createSkillTool(options: { skills: readonly Skill[]; loader: Pick<SkillLoader, 'content'> }): SkillTool {
  const invocable = new Map(options.skills.filter((s) => !s.disableModelInvocation).map((s) => [s.name, s]))
  const tool: CokoTool<typeof skillToolParameters, SkillToolDetails> = {
    name: SKILL_TOOL_NAME,
    label: SKILL_TOOL_NAME,
    description:
      'Load a skill listed in <available_skills>: returns its instructions, base directory and bundled files. Call it when the task ' +
      'matches the skill description, then follow the instructions. Read referenced files with the read tool.',
    parameters: skillToolParameters,
    effect: 'read',
    permissionSubject: (args) => args.name,
    async execute(_toolCallId, { name, args }) {
      const skill = invocable.get(name)
      if (!skill) {
        const known = [...invocable.keys()]
        throw new Error(`Unknown skill "${name}". ${known.length > 0 ? `Available skills: ${known.join(', ')}` : 'No skills are available.'}`)
      }
      const content = await options.loader.content(skill)
      const extra = args?.trim() ? `\n\nARGUMENTS: ${args.trim()}` : ''
      return {
        content: [{ type: 'text', text: formatSkillBlock(skill, content) + extra }],
        details: { name: skill.name, path: skill.path, baseDir: skill.baseDir, files: content.files, filesTruncated: content.filesTruncated },
      }
    },
  }
  return { tool: tool as CokoTool, permissionClass: 'context-read' }
}
