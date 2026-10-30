import { Type, type Static } from 'typebox'

// Worktree（ADR 0016）：Session 创建时绑定的 git worktree 与 /api/workspaces/:id/worktrees、/api/worktrees/:id、git-status 的 DTO。
// 没有自己的条目 kind。

const strict = { additionalProperties: false } as const
const Id = Type.String({ minLength: 1 })
const Count = Type.Integer({ minimum: 0 })

export const WorktreeStatus = Type.Union([Type.Literal('active'), Type.Literal('removed')])
export type WorktreeStatus = Static<typeof WorktreeStatus>

export const WorktreeCreator = Type.Union([Type.Literal('user'), Type.Literal('subagent')])
export type WorktreeCreator = Static<typeof WorktreeCreator>

/** worktree 名：小写字母、数字、点、下划线与连字符，以字母或数字开头。分支为 coko/<name>。 */
export const WORKTREE_NAME_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$'
/** worktree 相对仓库根的目录。 */
export const WORKTREES_DIR = '.coko-worktrees'

export const Worktree = Type.Object(
  {
    id: Id,
    workspaceId: Id,
    name: Type.String({ minLength: 1 }),
    path: Type.String(),
    branch: Type.String(),
    baseCommit: Type.String(),
    status: WorktreeStatus,
    createdBy: WorktreeCreator,
    sessionCount: Count,
  },
  strict,
)
export type Worktree = Static<typeof Worktree>
export const WorktreeListResponse = Type.Array(Worktree)
export type WorktreeListResponse = Static<typeof WorktreeListResponse>

/** Session DTO 中绑定的 worktree。 */
export const SessionWorktree = Type.Object({ id: Id, name: Type.String(), branch: Type.String(), status: WorktreeStatus }, strict)
export type SessionWorktree = Static<typeof SessionWorktree>

/** POST /api/workspaces/:id/worktrees → 201 Worktree。 */
export const CreateWorktreeRequest = Type.Object({ name: Type.Optional(Type.String({ minLength: 1 })) }, strict)
export type CreateWorktreeRequest = Static<typeof CreateWorktreeRequest>

/** GET /api/sessions/:id/git-status。 */
export const GitStatusResponse = Type.Object({ repo: Type.Boolean(), branch: Type.Optional(Type.String()), dirtyFiles: Count }, strict)
export type GitStatusResponse = Static<typeof GitStatusResponse>

export const worktreePaths = {
  /** GET WorktreeListResponse / POST CreateWorktreeRequest。 */
  workspaceWorktrees: (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}/worktrees`,
  /** DELETE（204）；busy 409 worktree-busy { reasons }、dirty 409 worktree-dirty { files }。 */
  worktree: (id: string) => `/api/worktrees/${encodeURIComponent(id)}`,
  /** GET GitStatusResponse。 */
  sessionGitStatus: (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/git-status`,
} as const
