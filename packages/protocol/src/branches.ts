import { Type, type Static } from 'typebox'
import { WorktreeDirtyDetails } from './worktrees.ts'

/** Branch checkout and worktree removal use the same capped dirty-file detail shape. */
export const GitDirtyDetails = WorktreeDirtyDetails
export type GitDirtyDetails = Static<typeof GitDirtyDetails>

/** Global user branch prefix; unrelated to the fixed coko/ worktree namespace. */
export const BRANCH_PREFIX_SETTING = 'git.branchPrefix'
export const BranchListResponse = Type.Object(
  {
    available: Type.Boolean(),
    reason: Type.Optional(Type.Union([Type.Literal('not-a-git-repo'), Type.Literal('git-unavailable')])),
    current: Type.Optional(Type.String()),
    branches: Type.Array(Type.Object({ name: Type.String(), committedAt: Type.Integer() }, { additionalProperties: false })),
  },
  { additionalProperties: false },
)
export type BranchListResponse = Static<typeof BranchListResponse>
export const CheckoutBranchRequest = Type.Object(
  { name: Type.String({ minLength: 1 }), create: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
)
export type CheckoutBranchRequest = Static<typeof CheckoutBranchRequest>
export const branchPaths = { project: (id: string) => `/api/projects/${encodeURIComponent(id)}/branches` } as const

/** Full refs/heads grammar, with branch-specific leading dash and HEAD rejection. Git independently validates at the host boundary. */
export function branchNameError(name: string): 'empty' | 'trailingSlash' | 'invalid' | undefined {
  if (!name) return 'empty'
  if (name.endsWith('/')) return 'trailingSlash'
  if (
    name === '@' ||
    name === 'HEAD' ||
    name.startsWith('-') ||
    name.startsWith('/') ||
    name.endsWith('.') ||
    name.includes('..') ||
    name.includes('@{') ||
    [...name].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || '~^:?*[\\'.includes(character)) ||
    name.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))
  )
    return 'invalid'
  return undefined
}
