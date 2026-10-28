// Checkpoint tracker（ADR 0006）：faux 模型 + 临时 Workspace + 内存快照端口，经 createAgentRuntime 的 hooks 与
// tracker 的公开接口观察 file_backup / file_change 条目、快照内容与 Workspace 文件。真实快照目录见集成测试。
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntime } from '../engine/runtime.ts'
import type { RunEntry } from '../engine/types.ts'
import { createLocalExecPort } from '../ports/local-exec.ts'
import type { PermissionMode } from '../session-entries/index.ts'
import { createFauxModels, fauxAssistantMessage, fauxToolCall } from '../testing/faux.ts'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { createCheckpointTracker, type CheckpointEntry, type SnapshotPort } from './index.ts'

let ws: TempWorkspace
beforeEach(async () => {
  ws = await createTempWorkspace('coko-checkpoint-')
})
afterEach(async () => {
  await ws.dispose()
})

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

/** 内存快照端口：按内容寻址保存字节；超过 maxBytes 报告 too-large。 */
function memorySnapshots(maxBytes = 1024 * 1024) {
  const blobs = new Map<string, Buffer>()
  const port: SnapshotPort = {
    async saveFile(path) {
      let bytes: Buffer
      try {
        bytes = await readFile(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }
        throw error
      }
      if (bytes.byteLength > maxBytes) return { kind: 'too-large' }
      const hash = sha256(bytes)
      blobs.set(hash, bytes)
      return { kind: 'stored', hash }
    },
    hashFile: async (path) => sha256(await readFile(path)),
  }
  return { port, blobs }
}

interface HarnessOptions {
  mode?: PermissionMode
  snapshots?: SnapshotPort
  /** 已提交的条目（重启后的 Session）。 */
  history?: CheckpointEntry[]
  messages?: Parameters<typeof createAgentRuntime>[0]['messages']
}

/** 模拟宿主：每条条目（运行时与 tracker 的）按提交顺序分配 seq，提交后交给 tracker.observe。 */
function harness(options: HarnessOptions = {}) {
  const { faux, models, model } = createFauxModels()
  const committed: CheckpointEntry[] = [...(options.history ?? [])]
  const snapshots = options.snapshots ?? memorySnapshots().port
  let tracker: ReturnType<typeof createCheckpointTracker>
  const publish = async (entry: RunEntry): Promise<CheckpointEntry> => {
    const stored: CheckpointEntry = { seq: committed.length + 1, kind: entry.kind, runId: entry.runId ?? null, payload: entry.payload }
    committed.push(stored)
    tracker.observe(stored)
    return stored
  }
  const history = [...committed]
  tracker = createCheckpointTracker({ cwd: ws.dir, snapshots, commit: publish, history: async () => history })
  const state = { mode: options.mode ?? 'accept-edits' }
  const runtime = createAgentRuntime({
    models,
    model,
    cwd: ws.dir,
    sessionId: 's1',
    exec: createLocalExecPort({ sandbox: { wrap: () => [], denialSignature: 'operation not permitted' } }),
    hooks: [tracker.hooks],
    ...(options.messages ? { messages: options.messages } : {}),
    commit: async (entry) => {
      await publish(entry)
    },
    permissions: { mode: () => state.mode as PermissionMode, rules: () => [] },
  })
  const of = (kind: string) => committed.filter((e) => e.kind === kind)
  const userSeqs = () => committed.filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user').map((e) => e.seq)
  return { faux, runtime, committed, of, userSeqs, state }
}

const edit = (id: string, path: string, oldText: string, newText: string) => fauxToolCall('edit', { path, edits: [{ oldText, newText }] }, { id })
const write = (id: string, path: string, content: string) => fauxToolCall('write', { path, content }, { id })
const bash = (id: string, command: string) => fauxToolCall('bash', { command }, { id })
const toolUse = (...calls: ReturnType<typeof fauxToolCall>[]) => fauxAssistantMessage(calls, { stopReason: 'toolUse' })

describe('checkpoint tracker', () => {
  it('同一锚点下对同一文件两次 edit 只备份一次（Run 前的内容）；新建文件记 absent；每次修改后记录 afterHash', async () => {
    const snapshots = memorySnapshots()
    const original = 'alpha\nbeta\n'
    const notes = await ws.write('notes.txt', original)
    const h = harness({ snapshots: snapshots.port })
    h.faux.setResponses([
      toolUse(edit('e1', 'notes.txt', 'alpha', 'ALPHA')),
      toolUse(edit('e2', 'notes.txt', 'beta', 'BETA'), write('w1', 'src/new.txt', 'fresh')),
      fauxAssistantMessage('done'),
    ])
    expect((await h.runtime.run('edit twice')).status).toBe('completed')

    const [anchor] = h.userSeqs()
    expect(h.of('file_backup').map((e) => e.payload)).toEqual([
      { anchorSeq: anchor, path: notes, blob: sha256(original) },
      { anchorSeq: anchor, path: ws.path('src/new.txt'), absent: true },
    ])
    expect(snapshots.blobs.get(sha256(original))?.toString()).toBe(original)
    expect(await readFile(notes, 'utf8')).toBe('ALPHA\nBETA\n')
    expect(h.of('file_change').map((e) => e.payload)).toEqual([
      { anchorSeq: anchor, path: notes, afterHash: sha256('ALPHA\nbeta\n') },
      { anchorSeq: anchor, path: notes, afterHash: sha256('ALPHA\nBETA\n') },
      { anchorSeq: anchor, path: ws.path('src/new.txt'), afterHash: sha256('fresh') },
    ])
    // 备份在执行记录之前：被备份的内容一定是执行前的版本。
    const order = h.committed
      .filter((e) => e.kind === 'file_backup' || e.kind === 'tool_exec')
      .map((e) => `${e.kind}:${(e.payload as { toolCallId?: string }).toolCallId ?? ''}`)
    expect(order.slice(0, 2)).toEqual(['file_backup:', 'tool_exec:e1'])
    expect(h.of('file_backup').every((e) => e.runId === h.of('run_start')[0]!.runId)).toBe(true)
  })

  it('第二条用户消息是新锚点：再次修改同一文件时备份第一个 Run 之后的版本', async () => {
    const snapshots = memorySnapshots()
    const notes = await ws.write('notes.txt', 'one\n')
    const h = harness({ snapshots: snapshots.port })
    h.faux.setResponses([
      toolUse(write('w1', 'notes.txt', 'two\n')),
      fauxAssistantMessage('first done'),
      toolUse(edit('e1', 'notes.txt', 'two', 'three')),
      fauxAssistantMessage('second done'),
    ])
    await h.runtime.run('first')
    await h.runtime.run('second')

    const [first, second] = h.userSeqs()
    expect(h.of('file_backup').map((e) => e.payload)).toEqual([
      { anchorSeq: first, path: notes, blob: sha256('one\n') },
      { anchorSeq: second, path: notes, blob: sha256('two\n') },
    ])
    expect(snapshots.blobs.get(sha256('two\n'))?.toString()).toBe('two\n')
    expect(await readFile(notes, 'utf8')).toBe('three\n')
  })

  it('bash 修改的文件不备份；超过快照上限的文件记 untracked、不保存内容', async () => {
    const snapshots = memorySnapshots(16)
    const big = await ws.write('big.txt', 'x'.repeat(17))
    await ws.write('script.txt', 'before')
    const h = harness({ mode: 'full-access', snapshots: snapshots.port })
    h.faux.setResponses([toolUse(bash('b1', 'printf after > script.txt'), write('w1', 'big.txt', 'small')), fauxAssistantMessage('done')])
    expect((await h.runtime.run('go')).status).toBe('completed')

    expect(await readFile(ws.path('script.txt'), 'utf8')).toBe('after')
    expect(h.of('file_backup').map((e) => e.payload)).toEqual([{ anchorSeq: h.userSeqs()[0], path: big, untracked: true }])
    expect(snapshots.blobs.size).toBe(0)
  })

  it('被拒绝审批的 write 不备份、不执行', async () => {
    const h = harness({ mode: 'default' })
    h.faux.setResponses([toolUse(write('w1', 'denied.txt', 'nope')), fauxAssistantMessage('never')])
    const run = h.runtime.run('write')
    await expect.poll(() => h.runtime.pendingApprovals.length).toBe(1)
    await h.runtime.answerApproval(h.runtime.pendingApprovals[0]!.requestId, { decision: 'deny' })
    expect((await run).status).toBe('aborted')

    expect(h.of('file_backup')).toEqual([])
    expect(h.of('file_change')).toEqual([])
    await expect(stat(ws.path('denied.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('快照失败时调用被拦下：文件不变、没有 file_backup，模型收到原因', async () => {
    const notes = await ws.write('notes.txt', 'keep')
    const failing: SnapshotPort = {
      saveFile: async () => {
        throw new Error('disk full')
      },
      hashFile: async () => sha256(''),
    }
    const h = harness({ snapshots: failing })
    h.faux.setResponses([toolUse(write('w1', 'notes.txt', 'lost')), fauxAssistantMessage('ok')])
    await h.runtime.run('write')

    expect(await readFile(notes, 'utf8')).toBe('keep')
    expect(h.of('file_backup')).toEqual([])
    expect(h.of('tool_exec')).toEqual([])
    const result = h.committed.find((e) => (e.payload as { role?: string }).role === 'toolResult')!.payload as { isError: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toMatch(/checkpoint/i)
  })

  it('重新创建（Sidecar 重启）后从已提交的条目恢复锚点：retry 时已备份的路径不再备份，新路径记在原锚点下', async () => {
    const notes = await ws.write('notes.txt', 'v1')
    await ws.write('other.txt', 'o1')
    const first = harness()
    first.faux.setResponses([toolUse(write('w1', 'notes.txt', 'v2')), fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'Invalid API key' })])
    expect((await first.runtime.run('go')).status).toBe('error')
    const [anchor] = first.userSeqs()

    const second = harness({ history: first.committed, messages: [...first.runtime.messages] })
    second.faux.setResponses([toolUse(write('w2', 'notes.txt', 'v3'), write('w3', 'other.txt', 'o2')), fauxAssistantMessage('done')])
    expect((await second.runtime.retry()).status).toBe('completed')

    expect(second.of('file_backup').map((e) => e.payload)).toEqual([
      { anchorSeq: anchor, path: notes, blob: sha256('v1') },
      { anchorSeq: anchor, path: ws.path('other.txt'), blob: sha256('o1') },
    ])
  })
})
