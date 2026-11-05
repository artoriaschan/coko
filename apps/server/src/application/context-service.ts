// 上下文的查询入口（HTTP 路由经此访问，不直接读存储）：作用域、上下文用量、命令目录、Skill 列表与 @ 文件候选。
import { searchWorkspaceFiles } from '@coko/agent'
import type { CommandListResponse, ContextUsageResponse, SkillListResponse, WorkspaceFilesResponse } from '@coko/protocol'
import type { SessionStore } from '@coko/session'
import { isCommandsContribution } from './context/commands.ts'
import type { ContextAssembly, ContextScope } from './context/index.ts'
import { isSkillsContribution } from './context/skills.ts'
import { contextUsage } from './context/usage.ts'
import { AppError } from './errors.ts'
import { workspaceCwd, type SessionCwd } from './session-runs.ts'
import { sessionProject } from './session-project.ts'
import type { SessionService } from './sessions.ts'

export interface ContextServiceOptions {
  store: SessionStore
  /** Same explicit prompt as SessionService, when evaluating a candidate. */
  basePrompt?: string
  assembly: ContextAssembly
  sessions: Pick<SessionService, 'contextModel' | 'baseTools' | 'compactionPaused'>
  /** Session 的工作目录（worktree 会话为其 worktree；缺省 Workspace 目录）：用量与作用域按它读取指令、Skills 与项目设置。 */
  cwd?: SessionCwd
}

export class ContextService {
  readonly #store: SessionStore
  readonly #basePrompt: string | undefined
  readonly #sessions: ContextServiceOptions['sessions']
  readonly #cwd: SessionCwd
  readonly assembly: ContextAssembly

  constructor(options: ContextServiceOptions) {
    this.#store = options.store
    this.#basePrompt = options.basePrompt
    this.assembly = options.assembly
    this.#sessions = options.sessions
    this.#cwd = options.cwd ?? workspaceCwd
  }

  async #workspace(workspaceId: string) {
    const workspace = await this.#store.sessions.getWorkspace(workspaceId)
    if (!workspace) throw new AppError('not-found', `Workspace ${workspaceId} not found`)
    return workspace
  }

  async #session(sessionId: string) {
    const session = await this.#store.sessions.getSession(sessionId)
    if (!session) throw new AppError('not-found', `Session ${sessionId} not found`)
    return session
  }

  /** 给出 sessionId 时取其 Workspace 与工作目录（SessionCwd，带 sessionId），否则按 workspaceId；都没有时 bad-request，不存在时 not-found。 */
  async scopeFor(input: { sessionId?: string | undefined; workspaceId?: string | undefined }): Promise<ContextScope> {
    if (input.sessionId === undefined && input.workspaceId === undefined) throw new AppError('bad-request', 'sessionId or workspaceId is required')
    if (input.sessionId === undefined) {
      const workspace = await this.#workspace(input.workspaceId!)
      const [model, projects] = await Promise.all([this.#sessions.contextModel(undefined), this.#store.projects.list()])
      const project = projects.find((p) => p.primaryWorkspaceId === workspace.id)
      return this.assembly.scope({
        workspaceId: workspace.id,
        cwd: workspace.path,
        additionalFolders: project?.additionalFolders ?? [],
        ...(model ? { model: { providerId: model.provider, modelId: model.id } } : {}),
      })
    }
    const session = await this.#session(input.sessionId)
    const workspace = await this.#workspace(session.workspaceId)
    const [model, project] = await Promise.all([this.#sessions.contextModel(session.model), sessionProject(this.#store, session)])
    return this.assembly.scope({
      workspaceId: workspace.id,
      cwd: await this.#cwd.resolve(session, workspace),
      sessionId: session.id,
      additionalFolders: project?.additionalFolders ?? [],
      ...(session.worktreeId ? { worktreeId: session.worktreeId } : {}),
      ...(model ? { model: { providerId: model.provider, modelId: model.id } } : {}),
    })
  }

  /** Session（其条目、模型与压缩熔断）或草稿（Workspace，缺省模型、没有条目）的上下文用量。 */
  async contextUsage(input: { sessionId: string } | { workspaceId: string }): Promise<ContextUsageResponse> {
    if ('sessionId' in input) {
      const session = await this.#session(input.sessionId)
      const workspace = await this.#workspace(session.workspaceId)
      const cwd = await this.#cwd.resolve(session, workspace)
      const [scope, entries, model] = await Promise.all([
        this.scopeFor({ sessionId: session.id }),
        this.#store.sessions.listEntries(session.id),
        this.#sessions.contextModel(session.model),
      ])
      return contextUsage({
        context: this.assembly,
        ...(this.#basePrompt ? { basePrompt: this.#basePrompt } : {}),
        scope,
        baseTools: this.#sessions.baseTools(cwd),
        model,
        entries,
        autoCompactPaused: this.#sessions.compactionPaused(session.id),
      })
    }
    const workspace = await this.#workspace(input.workspaceId)
    const [scope, model] = await Promise.all([this.scopeFor({ workspaceId: workspace.id }), this.#sessions.contextModel(undefined)])
    return contextUsage({
      context: this.assembly,
      ...(this.#basePrompt ? { basePrompt: this.#basePrompt } : {}),
      scope,
      baseTools: this.#sessions.baseTools(workspace.path),
      model,
      entries: [],
    })
  }

  /** 该作用域的命令目录与诊断（没有命令贡献时为空）。 */
  commands(scope: ContextScope): Promise<CommandListResponse> {
    const commands = this.assembly.contributions.find(isCommandsContribution)
    return commands ? commands.list(scope) : Promise.resolve({ commands: [], diagnostics: [] })
  }

  /** 该作用域的 Skill 列表与诊断（没有 Skill 贡献时为空）。 */
  skills(scope: ContextScope): Promise<SkillListResponse> {
    const skills = this.assembly.contributions.find(isSkillsContribution)
    return skills ? skills.list(scope) : Promise.resolve({ skills: [], diagnostics: [] })
  }

  /** @ 菜单的文件候选：遍历与内置 find / grep 相同，遵守忽略规则、不含 .git。 */
  async files(workspaceId: string, query: string, options: { limit: number; signal?: AbortSignal }): Promise<WorkspaceFilesResponse> {
    const workspace = await this.#workspace(workspaceId)
    return { files: await searchWorkspaceFiles(workspace.path, query, { limit: options.limit, ...(options.signal ? { signal: options.signal } : {}) }) }
  }
}
