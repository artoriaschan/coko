// Skill 的形状（ADR 0009：用户编写的资源为文件；ADR 0008：allowed-tools 只展示，不放行任何调用）。
import { dirname, join } from 'node:path'

/** project：<Workspace>/.coko/skills、<Workspace>/.agents/skills；user：COKO_HOME/skills 与其同级的 .agents/skills。 */
export type SkillScope = 'project' | 'user'

/** 一个发现位置；同名时排在前面的位置优先。 */
export interface SkillLocation {
  dir: string
  scope: SkillScope
}

/** 一个已发现且合规的 Skill（含 SKILL.md 的目录）。 */
export interface Skill {
  /** 等于目录名（Agent Skills 规范）。 */
  name: string
  description: string
  /** SKILL.md 的绝对路径。 */
  path: string
  /** Skill 目录（SKILL.md 所在目录）：额外读取根。 */
  baseDir: string
  scope: SkillScope
  /** frontmatter 的 allowed-tools：只记录与展示，不改变权限判定（ADR 0008）。 */
  allowedTools: string[]
  /** true 时不进 <available_skills> 索引、skill 工具不调用，只能由用户以 /<name> 显式调用。 */
  disableModelInvocation: boolean
  /** frontmatter 的 argument-hint（/ 菜单显示）。 */
  argumentHint?: string | undefined
}

/** skill 工具与 /<name> 展开需要的内容：去掉 frontmatter 的正文与 Skill 目录下的文件清单。 */
export interface SkillContent {
  body: string
  /** 相对 baseDir 的路径（posix 分隔），不含 SKILL.md 与 . 开头的项，按目录深度优先、名字排序。 */
  files: string[]
  filesTruncated: boolean
}

/** 用户级 .agents/skills 是 COKO_HOME 的同级目录：缺省 COKO_HOME=~/.coko 时即 ~/.agents/skills；测试的临时 COKO_HOME 不读真实家目录。 */
export function skillLocations(input: { cwd: string; cokoHome: string }): SkillLocation[] {
  const project: SkillLocation[] = [
    { dir: join(input.cwd, '.coko', 'skills'), scope: 'project' },
    { dir: join(input.cwd, '.agents', 'skills'), scope: 'project' },
  ]
  // COKO_HOME 为空时不读用户级（避免把相对路径解析到进程目录）。
  if (input.cokoHome === '') return project
  return [...project, { dir: join(input.cokoHome, 'skills'), scope: 'user' }, { dir: join(dirname(input.cokoHome), '.agents', 'skills'), scope: 'user' }]
}
