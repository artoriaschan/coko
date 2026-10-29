// Skills（GET /api/skills）。启停经 PUT /api/config 的 skills.enabled 与 skills.disabled（configPaths）。
import { Type, type Static } from 'typebox'
import { ResourceDiagnostic } from './config.ts'

const strict = { additionalProperties: false } as const

export const SkillScope = Type.Union([Type.Literal('project'), Type.Literal('user')])
export type SkillScope = Static<typeof SkillScope>

/** 一个已发现且合规的 Skill（同名只列优先的一个，被遮蔽的只出现在诊断中）。 */
export const SkillInfo = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    description: Type.String(),
    /** SKILL.md 的绝对路径。 */
    path: Type.String(),
    scope: SkillScope,
    /** skills.enabled 且不在有效的 skills.disabled（全局与项目追加）中。 */
    enabled: Type.Boolean(),
    /** frontmatter 的 allowed-tools：只展示，不放行任何调用（ADR 0008）。 */
    allowedTools: Type.Array(Type.String()),
    /** true 时不进模型索引，只能以 /<name> 显式调用。 */
    disableModelInvocation: Type.Boolean(),
  },
  strict,
)
export type SkillInfo = Static<typeof SkillInfo>

/** GET /api/skills?workspaceId=…：按优先级（项目 .coko > 项目 .agents > 用户 COKO_HOME/skills > 用户 .agents/skills）与名字排列。 */
export const SkillListResponse = Type.Object({ skills: Type.Array(SkillInfo), diagnostics: Type.Array(ResourceDiagnostic) }, strict)
export type SkillListResponse = Static<typeof SkillListResponse>

export const skillPaths = {
  /** GET：Skill 列表与诊断；查询参数 workspaceId（缺时 400，不存在时 404）。 */
  skills: '/api/skills',
} as const
