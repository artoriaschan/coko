import type { Session, Worktree } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../client/api.ts'
import { createWorktreesStore, removeBlock, type WorktreesBackend } from './worktrees-store.ts'

const worktree = (id: string, status: Worktree['status'] = 'active'): Worktree => ({
  id,
  workspaceId: 'w',
  name: id,
  path: `/r/.coko-worktrees/${id}`,
  branch: `coko/${id}`,
  baseCommit: 'abc',
  status,
  createdBy: 'user',
  sessionCount: 0,
})

function backend(overrides: Partial<WorktreesBackend> = {}): WorktreesBackend & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    list: async (workspaceId) => (calls.push(`list:${workspaceId}`), [worktree('a')]),
    create: async (workspaceId, name) => (calls.push(`create:${workspaceId}:${name ?? ''}`), worktree(name ?? 'gen')),
    createSession: async (workspaceId, worktreeId) => (calls.push(`session:${workspaceId}:${worktreeId}`), { id: 's1' } as Session),
    remove: async (id) => void calls.push(`remove:${id}`),
    ...overrides,
  }
}

describe('worktrees-store', () => {
  it('createSession：先创建 worktree，再以它的 id 创建 Session，之后重读列表', async () => {
    const b = backend()
    const store = createWorktreesStore(b)
    expect((await store.getState().createSession('w', 'feat')).id).toBe('s1')
    await expect.poll(() => store.getState().workspaces.w?.status).toBe('ready')
    expect(b.calls).toEqual(['create:w:feat', 'session:w:feat', 'list:w'])
  })

  it('remove：busy / dirty 返回并记下原因；其他错误抛出', async () => {
    const errors = [
      new ApiError('worktree-busy', 'busy', 409, { reasons: ['job', 'run'] }),
      new ApiError('worktree-dirty', 'dirty', 409, { files: ['a.txt'], count: 1 }),
      new ApiError('internal', 'x', 500),
    ]
    const store = createWorktreesStore(backend({ remove: async () => Promise.reject(errors.shift()) }))
    expect(await store.getState().remove('w', 'a')).toEqual({ kind: 'busy', reasons: ['job', 'run'] })
    expect(store.getState().blocked.a).toEqual({ kind: 'busy', reasons: ['job', 'run'] })
    expect(await store.getState().remove('w', 'a')).toEqual({ kind: 'dirty', files: ['a.txt'], count: 1 })
    await expect(store.getState().remove('w', 'a')).rejects.toMatchObject({ code: 'internal' })
    expect(store.getState().blocked.a).toBeUndefined()
  })

  it('对手用例：details 不合 schema 的 409 不当作可显示的原因', () => {
    expect(removeBlock(new ApiError('worktree-busy', 'x', 409, { reasons: ['<script>'] }))).toBeUndefined()
    expect(removeBlock(new ApiError('worktree-dirty', 'x', 409, { files: 'a', count: 1 }))).toBeUndefined()
    expect(removeBlock(new ApiError('worktree-dirty', 'x', 409))).toBeUndefined()
    expect(removeBlock(new Error('x'))).toBeUndefined()
  })
})
