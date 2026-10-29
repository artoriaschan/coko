// Skills（票 05）：<available_skills> system section、skill 工具（context-read）、Skill 目录作为额外读取根、向命令目录登记 /<skill-name>，
// 以及 GET /api/skills 的列表。受 skills.enabled 与 skills.disabled（全局与项目追加）控制；allowed-tools 只展示（ADR 0008）。
import {
  createSkillLoader,
  createSkillTool,
  expandSkillInvocation,
  skillLocations,
  skillsSection,
  type ResourceDiagnostic,
  type Skill,
  type SkillLoader,
} from '@coko/agent'
import { getLogger } from '@coko/logging'
import type { SkillListResponse } from '@coko/protocol'
import { AppError } from '../errors.ts'
import type { SourcedCommand } from './commands.ts'
import type { ContextContribution, ContextContributionOptions, ContextScope } from './types.ts'

const log = getLogger(['application', 'context', 'skills'])
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

interface SkillCatalog {
  /** 已发现的全部 Skill（含停用的）。 */
  skills: Skill[]
  /** 本作用域启用的 Skill。 */
  enabled: Skill[]
  diagnostics: ResourceDiagnostic[]
}

export interface SkillsContribution extends ContextContribution {
  name: 'skills'
  /** GET /api/skills 的响应。 */
  list(scope: ContextScope): Promise<SkillListResponse>
}

export const isSkillsContribution = (contribution: ContextContribution): contribution is SkillsContribution =>
  contribution.name === 'skills' && typeof (contribution as Partial<SkillsContribution>).list === 'function'

export interface SkillsContributionOptions extends ContextContributionOptions {
  /** 测试注入。 */
  loader?: SkillLoader
}

export function skillsContribution(options: SkillsContributionOptions): SkillsContribution {
  const loader = options.loader ?? createSkillLoader()
  // 同一作用域（一个 Run 开始时取值的一次快照）只发现一次；SKILL.md 另按 mtime 缓存。
  const catalogs = new WeakMap<ContextScope, Promise<SkillCatalog>>()

  const catalog = (scope: ContextScope): Promise<SkillCatalog> => {
    let found = catalogs.get(scope)
    if (!found) {
      found = (async () => {
        const { skills, diagnostics } = await loader.discover(skillLocations({ cwd: scope.cwd, cokoHome: scope.cokoHome }))
        const disabled = new Set(scope.config.skills.disabled)
        const enabled = scope.config.skills.enabled ? skills.filter((s) => !disabled.has(s.name)) : []
        return { skills, enabled, diagnostics }
      })()
      catalogs.set(scope, found)
      found.catch(() => catalogs.delete(scope))
    }
    return found
  }

  const section = async (scope: ContextScope) => skillsSection((await catalog(scope)).enabled)

  const command = (skill: Skill, enabled: boolean): SourcedCommand => ({
    name: skill.name,
    description: skill.description,
    ...(skill.argumentHint === undefined ? {} : { argumentHint: skill.argumentHint }),
    source: 'skill',
    path: skill.path,
    enabled,
    async expand(args) {
      try {
        return expandSkillInvocation(skill, await loader.content(skill), args)
      } catch (error) {
        throw new AppError('bad-request', `Cannot load skill "${skill.name}": ${message(error)}`)
      }
    },
  })

  return {
    name: 'skills',
    async systemSections(scope) {
      const built = await section(scope)
      return built ? [built] : []
    },
    async tools(scope) {
      const { enabled } = await catalog(scope)
      // 只有可由模型调用的 Skill 时才注册 skill 工具（没有 Skill 时工具清单与 M2 相同）。
      if (!enabled.some((s) => !s.disableModelInvocation)) return []
      return [createSkillTool({ skills: enabled, loader })]
    },
    async readRoots(scope) {
      return (await catalog(scope)).enabled.map((s) => s.baseDir)
    },
    commandSources: [
      {
        source: 'skill',
        async list(scope) {
          const { skills, enabled } = await catalog(scope)
          const on = new Set(enabled)
          return skills.map((s) => command(s, on.has(s)))
        },
      },
    ],
    async report(scope) {
      const [built, { diagnostics }] = await Promise.all([section(scope), catalog(scope)])
      return { breakdown: { skills: built?.text.length ?? 0 }, diagnostics }
    },
    async list(scope) {
      const { skills, enabled, diagnostics } = await catalog(scope)
      const on = new Set(enabled)
      log.debug('skills listed', { workspaceId: scope.workspaceId, count: skills.length, diagnostics: diagnostics.length })
      return {
        skills: skills.map((s) => ({
          name: s.name,
          description: s.description,
          path: s.path,
          scope: s.scope,
          enabled: on.has(s),
          allowedTools: s.allowedTools,
          disableModelInvocation: s.disableModelInvocation,
        })),
        diagnostics,
      }
    },
  }
}
