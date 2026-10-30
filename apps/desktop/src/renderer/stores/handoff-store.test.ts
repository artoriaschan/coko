// 交接 store：由条目推进进度（摘要中 → 创建中 → 切到目标会话并写入草稿；停止）；打开会话时补发的历史 handoff 条目不触发切换；
// 用户已离开源会话时只写草稿、不切换。
import type { SessionEntryRecord } from '@coko/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createFixtureChat } from '../testing/fixture-chat.ts'
import { createHandoffStore, type HandoffBackend } from './handoff-store.ts'

const record = (sessionId: string, seq: number, kind: string, payload: unknown, runId: string | null = 'h1'): SessionEntryRecord => ({
  sessionId,
  seq,
  kind,
  payloadVersion: 1,
  payload,
  runId,
  createdAt: seq,
})
const handoffEntry = (seq: number, target = 's-3', summary = '## Task\nnext') =>
  record('s-1', seq, 'handoff', { targetSessionId: target, instructions: 'next', summary, target: 'current' })

const backend = (extra: Partial<HandoffBackend> = {}): HandoffBackend => ({
  start: async () => ({ runId: 'h1' }),
  gitStatus: async () => ({ repo: true, branch: 'main', dirtyFiles: 2 }),
  stop: async () => undefined,
  ...extra,
})

async function setup(options: { history?: SessionEntryRecord[]; backend?: Partial<HandoffBackend> } = {}) {
  const fixture = createFixtureChat(options.history ? { entries: { 's-1': options.history } } : {})
  const writeDraft = vi.fn<(sessionId: string, text: string) => void>()
  const store = createHandoffStore({ backend: backend(options.backend), writeDraft })
  const off = store.getState().attach(fixture.chat)
  await vi.waitFor(() => expect(fixture.chat.getState().listStatus).toBe('ready'))
  fixture.chat.getState().openSession('s-1')
  await vi.waitFor(() => expect(fixture.chat.getState().conversations['s-1']?.status).toBe('ready'))
  const push = (entry: SessionEntryRecord) => fixture.sendServer({ type: 'entry', sessionId: entry.sessionId, entry })
  return { ...fixture, store, writeDraft, off, push }
}

describe('handoff store', () => {
  it('摘要 Run 开始 → 进行中；正常结束 → 创建中；handoff 条目 → 目标会话写入草稿并切换，进度清除', async () => {
    const h = await setup()
    const last = h.chat.getState().conversations['s-1']!.lastSeq
    h.push(record('s-1', last + 1, 'run_start', { trigger: 'handoff' }))
    expect(h.store.getState().progress['s-1']).toEqual({ phase: 'summarizing', runId: 'h1' })
    h.push(record('s-1', last + 2, 'run_end', { status: 'completed' }))
    expect(h.store.getState().progress['s-1']).toEqual({ phase: 'creating', runId: 'h1' })
    h.push(handoffEntry(last + 3, 's-3', '## Task\nbuild login'))
    await vi.waitFor(() => expect(h.chat.getState().activeSessionId).toBe('s-3'))
    expect(h.writeDraft).toHaveBeenCalledExactlyOnceWith('s-3', '## Task\nbuild login')
    expect(h.store.getState().progress['s-1']).toBeUndefined()
    h.off()
  })

  it('摘要 Run 被停止：stopped，不写草稿、不切换；dismiss 清除', async () => {
    const h = await setup()
    const last = h.chat.getState().conversations['s-1']!.lastSeq
    h.push(record('s-1', last + 1, 'run_start', { trigger: 'handoff' }))
    h.push(record('s-1', last + 2, 'run_end', { status: 'aborted' }))
    expect(h.store.getState().progress['s-1']).toEqual({ phase: 'stopped', runId: 'h1' })
    h.store.getState().dismiss('s-1')
    expect(h.store.getState().progress['s-1']).toBeUndefined()
    expect(h.writeDraft).not.toHaveBeenCalled()
    expect(h.chat.getState().activeSessionId).toBe('s-1')
  })

  it('打开会话时补发的历史 handoff 条目不切换、不写草稿', async () => {
    const h = await setup({
      history: [record('s-1', 1, 'run_start', { trigger: 'handoff' }), record('s-1', 2, 'run_end', { status: 'completed' }), handoffEntry(3)],
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(h.chat.getState().activeSessionId).toBe('s-1')
    expect(h.writeDraft).not.toHaveBeenCalled()
    expect(h.store.getState().progress).toEqual({})
  })

  it('用户已切到别的会话：只写目标草稿，不切换', async () => {
    const h = await setup()
    const last = h.chat.getState().conversations['s-1']!.lastSeq
    h.push(record('s-1', last + 1, 'run_start', { trigger: 'handoff' }))
    h.chat.getState().openSession('s-4')
    h.push(handoffEntry(last + 2, 's-3'))
    await vi.waitFor(() => expect(h.writeDraft).toHaveBeenCalledWith('s-3', '## Task\nnext'))
    await new Promise((r) => setTimeout(r, 20))
    expect(h.chat.getState().activeSessionId).toBe('s-4')
  })

  it('start：202 后立即为进行中；响应晚于 run_end 到达时不再记为进行中；失败时抛出且无进度', async () => {
    const h = await setup()
    await h.store.getState().start('s-1', { instructions: 'next', target: { kind: 'current' } })
    expect(h.store.getState().progress['s-1']).toEqual({ phase: 'summarizing', runId: 'h1' })

    let release!: () => void
    const late = await setup({ backend: { start: () => new Promise((resolve) => (release = () => resolve({ runId: 'h1' }))) } })
    const last = late.chat.getState().conversations['s-1']!.lastSeq
    const pending = late.store.getState().start('s-1', { instructions: 'next', target: { kind: 'current' } })
    late.push(record('s-1', last + 1, 'run_start', { trigger: 'handoff' }))
    late.push(record('s-1', last + 2, 'run_end', { status: 'aborted' }))
    release()
    await pending
    expect(late.store.getState().progress['s-1']).toEqual({ phase: 'stopped', runId: 'h1' })

    const failing = await setup({ backend: { start: async () => Promise.reject(new Error('409')) } })
    await expect(failing.store.getState().start('s-1', { instructions: 'n', target: { kind: 'current' } })).rejects.toThrow('409')
    expect(failing.store.getState().progress).toEqual({})
  })

  it('loadGitStatus：成功时记下，失败时为 null', async () => {
    const h = await setup()
    await h.store.getState().loadGitStatus('s-1')
    expect(h.store.getState().gitStatus['s-1']).toEqual({ repo: true, branch: 'main', dirtyFiles: 2 })
    const failing = await setup({ backend: { gitStatus: async () => Promise.reject(new Error('x')) } })
    await failing.store.getState().loadGitStatus('s-1')
    expect(failing.store.getState().gitStatus['s-1']).toBeNull()
  })
})
