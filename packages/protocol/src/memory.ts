// Memory（/api/memories）：跨 Session 保留的记忆条目（Memory Entry），属于用户或某个 Workspace（ADR 0003）。
import { Type, type Static } from 'typebox'

const strict = { additionalProperties: false } as const

/** 单条记忆正文的上限（字符，按 UTF-16 码元；与 agent 的 MEMORY_MAX_CHARS 相同）。 */
export const MEMORY_CONTENT_MAX = 2000

export const MemoryScope = Type.Union([Type.Literal('user'), Type.Literal('workspace')])
export type MemoryScope = Static<typeof MemoryScope>

/** 写入方：模型经 memory_write，或用户在设置中添加 / 编辑（编辑不改变原写入方）。 */
export const MemorySource = Type.Union([Type.Literal('model'), Type.Literal('user')])
export type MemorySource = Static<typeof MemorySource>

export const MemoryEntry = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    scope: MemoryScope,
    /** workspace 作用域为其 Workspace，user 作用域为 null。 */
    workspaceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    content: Type.String(),
    source: MemorySource,
    createdAt: Type.Integer({ minimum: 0 }),
    updatedAt: Type.Integer({ minimum: 0 }),
  },
  strict,
)
export type MemoryEntry = Static<typeof MemoryEntry>

/** GET /api/memories?workspaceId=…：用户级条目，给出 workspaceId 时另加该 Workspace 的条目；updatedAt 倒序。Workspace 不存在 404。 */
export const MemoryListResponse = Type.Object({ memories: Type.Array(MemoryEntry) }, strict)
export type MemoryListResponse = Static<typeof MemoryListResponse>

const Content = Type.String({ minLength: 1, description: `At most ${MEMORY_CONTENT_MAX} characters after trimming` })

/** POST /api/memories：workspace 作用域须给出 workspaceId，user 作用域不得给出；201 返回条目（source: user）。 */
export const CreateMemoryRequest = Type.Object({ scope: MemoryScope, workspaceId: Type.Optional(Type.String({ minLength: 1 })), content: Content }, strict)
export type CreateMemoryRequest = Static<typeof CreateMemoryRequest>

/** PUT /api/memories/:id：只改正文；?workspaceId 给出时条目须属于用户级或该 Workspace。 */
export const UpdateMemoryRequest = Type.Object({ content: Content }, strict)
export type UpdateMemoryRequest = Static<typeof UpdateMemoryRequest>

export const memoryPaths = {
  /** GET（列表）/ POST（新建）。 */
  memories: '/api/memories',
  /** PUT（改正文）/ DELETE（204）。 */
  memory: (id: string) => `/api/memories/${encodeURIComponent(id)}`,
} as const
