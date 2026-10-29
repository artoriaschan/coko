// 回退与有效上下文（ADR 0006）：纯函数 effectiveEntries / planRewind 由已提交的条目断言；restoreFiles 在临时
// Workspace 上断言文件内容（逐字节）与报告。真实快照目录与模型请求见集成测试 sidecar-rewind。
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTempWorkspace, type TempWorkspace } from '../testing/workspace.ts'
import { forkEntries } from '../agents/index.ts'
import { effectiveEntries } from '../entries/index.ts'
import { effectiveMessages, planRewind, restoreFiles, RewindTargetError, type CheckpointEntry, type RewindFilePlan, type RewindFiles } from './index.ts'

type Row = Omit<CheckpointEntry, 'seq'>
const user = (text: string, runId = 'r'): Row => ({ kind: 'message', runId, payload: { role: 'user', content: [{ type: 'text', text }] } })
const reply = (text: string, runId = 'r'): Row => ({
  kind: 'message',
  runId,
  payload: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
})
const rewind = (targetSeq: number): Row => ({ kind: 'rewind', runId: null, payload: { targetSeq } })
const H = (c: string) => c.repeat(64)
const backup = (anchorSeq: number, path: string, state: { blob: string } | { absent: true } | { untracked: true }, runId = 'r'): Row => ({
  kind: 'file_backup',
  runId,
  payload: { anchorSeq, path, ...state },
})
const change = (anchorSeq: number, path: string, afterHash: string, runId = 'r'): Row => ({
  kind: 'file_change',
  runId,
  payload: { anchorSeq, path, afterHash },
})
const exec = (id: string, toolName: string, runId = 'r'): Row => ({
  kind: 'tool_exec',
  runId,
  payload: { toolCallId: id, toolName, idempotencyKey: 's:' + id },
})
const runStart = (runId: string): Row => ({ kind: 'run_start', runId, payload: { trigger: 'submit' } })
const runEnd = (runId: string, status = 'completed'): Row => ({ kind: 'run_end', runId, payload: { status } })
const seqd = (rows: Row[]): CheckpointEntry[] => rows.map((row, i) => ({ ...row, seq: i + 1 }))
const texts = (entries: readonly CheckpointEntry[]) => effectiveMessages(entries).map((m) => (m as { content: { text: string }[] }).content[0]?.text ?? '')

describe('有效上下文', () => {
  it('跳过 [targetSeq, rewind) 区间，rewind 条目本身不进入上下文', () => {
    // 1 one, 2 reply, 3 two, 4 reply, 5 rewind→3
    const entries = seqd([user('one'), reply('a1'), user('two'), reply('a2'), rewind(3)])
    expect(effectiveEntries(entries).map((e) => e.seq)).toEqual([1, 2])
    expect(texts(entries)).toEqual(['one', 'a1'])
  })

  it('两次回退叠加：嵌套与不相交的区间都被跳过', () => {
    const entries = seqd([
      user('one'), // 1
      reply('a1'), // 2
      user('two'), // 3
      reply('a2'), // 4
      rewind(3), // 5：隐藏 3–4
      user('two again'), // 6
      reply('a2b'), // 7
      user('three'), // 8
      reply('a3'), // 9
      rewind(8), // 10：隐藏 8–9
      user('three again'), // 11
      reply('a3b'), // 12
      rewind(1), // 13：隐藏 1–12（包住前两次）
      user('fresh'), // 14
    ])
    expect(texts(entries)).toEqual(['fresh'])
    expect(texts(entries.slice(0, 12))).toEqual(['one', 'a1', 'two again', 'a2b', 'three again', 'a3b'])
  })

  it('回退之后的新消息正常进入上下文', () => {
    const entries = seqd([user('one'), reply('a1'), user('two'), reply('a2'), rewind(3), user('two, differently'), reply('a2c')])
    expect(texts(entries)).toEqual(['one', 'a1', 'two, differently', 'a2c'])
  })
})
describe('planRewind', () => {
  // 三条消息，每条 edit 同一文件；第二条另新建一个文件。
  const A = '/w/a.txt'
  const B = '/w/b.txt'
  const history = seqd([
    runStart('r1'), // 1
    user('one', 'r1'), // 2
    backup(2, A, { blob: H('0') }, 'r1'), // 3
    exec('e1', 'edit', 'r1'), // 4
    change(2, A, H('1'), 'r1'), // 5
    runEnd('r1'), // 6
    runStart('r2'), // 7
    user('two', 'r2'), // 8
    backup(8, A, { blob: H('1') }, 'r2'), // 9
    exec('e2', 'edit', 'r2'), // 10
    change(8, A, H('2'), 'r2'), // 11
    backup(8, B, { absent: true }, 'r2'), // 12
    exec('w2', 'write', 'r2'), // 13
    change(8, B, H('b'), 'r2'), // 14
    runEnd('r2'), // 15
    runStart('r3'), // 16
    user('three', 'r3'), // 17
    backup(17, A, { blob: H('2') }, 'r3'), // 18
    exec('e3', 'edit', 'r3'), // 19
    change(17, A, H('3'), 'r3'), // 20
    runEnd('r3'), // 21
  ])

  it('code：目标锚点及之后追踪过的每个路径取最早的备份，记录的最后状态是最后一次 file_change', () => {
    const plan = planRewind(history, 8, 'code')
    expect(plan).toMatchObject({ targetSeq: 8, mode: 'code', text: 'two' })
    expect(plan.entry).toBeUndefined()
    expect(plan.files).toEqual([
      { path: A, restore: { kind: 'content', blob: H('1') }, recorded: { kind: 'content', hash: H('3') } },
      { path: B, restore: { kind: 'delete' }, recorded: { kind: 'content', hash: H('b') } },
    ])
  })

  it('conversation：只给出 rewind 条目与目标文本，不涉及文件；both 两者都有', () => {
    expect(planRewind(history, 8, 'conversation')).toEqual({
      targetSeq: 8,
      mode: 'conversation',
      text: 'two',
      entry: { kind: 'rewind', payload: { targetSeq: 8 } },
      files: [],
    })
    const both = planRewind(history, 17, 'both')
    expect(both.entry).toEqual({ kind: 'rewind', payload: { targetSeq: 17 } })
    expect(both.files.map((f) => [f.path, f.restore])).toEqual([[A, { kind: 'content', blob: H('2') }]])
  })

  it('目标必须是有效的用户消息：不存在、不是用户消息或已被回退时 RewindTargetError', () => {
    expect(() => planRewind(history, 99, 'code')).toThrow(RewindTargetError)
    expect(() => planRewind(history, 3, 'conversation')).toThrow(RewindTargetError)
    const rewound = seqd([...history.map(({ seq: _seq, ...row }) => row), rewind(8)])
    expect(() => planRewind(rewound, 17, 'both')).toThrow(RewindTargetError)
    expect(planRewind(rewound, 2, 'conversation').text).toBe('one')
  })

  it('超限未追踪的最早备份不能恢复：restore untracked', () => {
    const entries = seqd([user('one'), backup(1, A, { untracked: true }), exec('w1', 'write'), change(1, A, H('1'))])
    expect(planRewind(entries, 1, 'code').files).toEqual([{ path: A, restore: { kind: 'untracked' }, recorded: { kind: 'content', hash: H('1') } }])
  })

  it('被中断的 Run 中执行了 write / edit 却没有 file_change（恢复补齐的结果）：该路径的记录状态为 unknown，不按备份比对', () => {
    // 恢复补齐的 toolResult（Applied / confirmation）不提交 file_change。
    const entries = seqd([
      runStart('r1'),
      user('one', 'r1'),
      backup(2, A, { blob: H('0') }, 'r1'),
      exec('w1', 'write', 'r1'),
      {
        kind: 'message',
        runId: 'r1',
        payload: { role: 'toolResult', toolCallId: 'w1', toolName: 'write', content: [{ type: 'text', text: 'Applied: …' }], isError: false },
      },
      runEnd('r1', 'interrupted'),
    ])
    expect(planRewind(entries, 2, 'code').files).toEqual([{ path: A, restore: { kind: 'content', blob: H('0') }, recorded: { kind: 'unknown' } }])
    // 同一路径之后又有完整记录：以后来的为准。
    const later = seqd([
      ...entries.map(({ seq: _seq, ...row }) => row),
      runStart('r2'),
      user('two', 'r2'),
      backup(8, A, { blob: H('9') }, 'r2'),
      exec('e2', 'edit', 'r2'),
      change(8, A, H('a'), 'r2'),
      runEnd('r2'),
    ])
    expect(planRewind(later, 2, 'code').files).toEqual([{ path: A, restore: { kind: 'content', blob: H('0') }, recorded: { kind: 'content', hash: H('a') } }])
  })

  it('只有备份、没有 file_change（write 失败或文件仍不存在）：记录状态取备份', () => {
    const entries = seqd([runStart('r1'), user('one', 'r1'), backup(2, B, { absent: true }, 'r1'), exec('w1', 'write', 'r1'), runEnd('r1')])
    // 完整结束的 Run：执行数与 file_change 数不一致也不是"结果不明"（调用本身失败）。
    expect(planRewind(entries, 2, 'code').files).toEqual([{ path: B, restore: { kind: 'delete' }, recorded: { kind: 'absent' } }])
  })
})
describe('restoreFiles', () => {
  let ws: TempWorkspace
  beforeEach(async () => {
    ws = await createTempWorkspace('coko-rewind-')
  })
  afterEach(async () => {
    await ws.dispose()
  })
  const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
  const blobs = new Map<string, Buffer>()
  const keep = (content: string) => {
    const bytes = Buffer.from(content)
    blobs.set(sha256(bytes), bytes)
    return sha256(bytes)
  }
  const port: RewindFiles = {
    hashFile: async (path) => sha256(await readFile(path)),
    readBlob: async (hash) => {
      const bytes = blobs.get(hash)
      if (!bytes) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return bytes
    },
    async writeFile(path, bytes) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(`${path}.tmp`, bytes)
      await rename(`${path}.tmp`, path)
    },
    remove: (path) => rm(path, { force: true }),
  }
  const options = () => ({ workspace: ws.dir })
  const absent = (path: string) =>
    stat(path).then(
      () => false,
      () => true,
    )

  async function scenario() {
    const a = await ws.write('a.txt', 'v3')
    const b = await ws.write('src/b.txt', 'created later')
    const c = await ws.write('c.txt', 'edited by the user')
    const big = await ws.write('big.bin', 'too large to keep')
    const files: RewindFilePlan[] = [
      { path: a, restore: { kind: 'content', blob: keep('v1') }, recorded: { kind: 'content', hash: sha256('v3') } },
      { path: b, restore: { kind: 'delete' }, recorded: { kind: 'content', hash: sha256('created later') } },
      { path: c, restore: { kind: 'content', blob: keep('c before') }, recorded: { kind: 'content', hash: sha256('c by coko') } },
      { path: big, restore: { kind: 'untracked' }, recorded: { kind: 'unknown' } },
      // 文件已被删除、目录也不在：恢复时重建。
      { path: ws.path('gone/d.txt'), restore: { kind: 'content', blob: keep('d before') }, recorded: { kind: 'content', hash: sha256('d by coko') } },
    ]
    return { a, b, c, big, files }
  }

  it('dry-run 只报告：恢复、删除、Agent 之外改过（含被删除的）与未追踪，不改任何文件', async () => {
    const { a, b, c, big, files } = await scenario()
    const report = await restoreFiles(files, port, { ...options(), dryRun: true })
    expect(report).toEqual({
      restored: [a, c, ws.path('gone/d.txt')],
      deleted: [b],
      diverged: [c, ws.path('gone/d.txt')],
      untracked: [big],
      outside: [],
      skipped: [],
    })
    expect(await readFile(a, 'utf8')).toBe('v3')
    expect(await readFile(b, 'utf8')).toBe('created later')
    expect(await readFile(c, 'utf8')).toBe('edited by the user')
    expect(await absent(ws.path('gone'))).toBe(true)
  })

  it('执行：内容逐字节等于备份，原先不存在的删除，未追踪的不动；已是目标状态的不再列出', async () => {
    const { a, b, c, big, files } = await scenario()
    const report = await restoreFiles(files, port, options())
    expect(report.restored).toEqual([a, c, ws.path('gone/d.txt')])
    expect(await readFile(a, 'utf8')).toBe('v1')
    expect(await readFile(c, 'utf8')).toBe('c before')
    expect(await readFile(ws.path('gone/d.txt'), 'utf8')).toBe('d before')
    expect(await absent(b)).toBe(true)
    expect(await readFile(big, 'utf8')).toBe('too large to keep')
    // 再执行一次：都已是目标状态。
    expect(await restoreFiles(files, port, { ...options(), dryRun: true })).toMatchObject({ restored: [], deleted: [] })
  })

  it('Workspace 之外与受保护路径单独列出（照常恢复，由确认对话框显式警告）', async () => {
    const elsewhere = await createTempWorkspace('coko-rewind-out-')
    try {
      const out = await elsewhere.write('rc', 'changed')
      const git = await ws.write('.git/config', 'changed')
      const files: RewindFilePlan[] = [
        { path: out, restore: { kind: 'content', blob: keep('rc before') }, recorded: { kind: 'content', hash: sha256('changed') } },
        { path: git, restore: { kind: 'content', blob: keep('config before') }, recorded: { kind: 'content', hash: sha256('changed') } },
      ]
      expect(await restoreFiles(files, port, { ...options(), dryRun: true })).toMatchObject({ restored: [out, git], outside: [out, git], skipped: [] })
      await restoreFiles(files, port, options())
      expect(await readFile(out, 'utf8')).toBe('rc before')
    } finally {
      await elsewhere.dispose()
    }
  })

  it('父目录在备份之后被替换为符号链接：该路径跳过，链接指向的文件不变', async () => {
    const elsewhere = await createTempWorkspace('coko-rewind-link-')
    try {
      const victim = await elsewhere.write('d.txt', 'not yours')
      const recorded = ws.path('dir/d.txt')
      await symlink(elsewhere.dir, ws.path('dir'))
      const files: RewindFilePlan[] = [
        { path: recorded, restore: { kind: 'content', blob: keep('d before') }, recorded: { kind: 'content', hash: sha256('d by coko') } },
        { path: join(ws.dir, 'dir', 'new.txt'), restore: { kind: 'delete' }, recorded: { kind: 'absent' } },
      ]
      await elsewhere.write('new.txt', 'also not yours')
      const report = await restoreFiles(files, port, options())
      expect(report).toMatchObject({ restored: [], deleted: [], skipped: [recorded, join(ws.dir, 'dir', 'new.txt')] })
      expect(await readFile(victim, 'utf8')).toBe('not yours')
      expect(await readFile(join(elsewhere.dir, 'new.txt'), 'utf8')).toBe('also not yours')
    } finally {
      await elsewhere.dispose()
    }
  })

  it('记录为 unknown 的路径不算 Agent 之外改过；记录为不存在而现在存在的算', async () => {
    const x = await ws.write('x.txt', 'whatever')
    const y = await ws.write('y.txt', 'appeared')
    const report = await restoreFiles(
      [
        { path: x, restore: { kind: 'content', blob: keep('x0') }, recorded: { kind: 'unknown' } },
        { path: y, restore: { kind: 'delete' }, recorded: { kind: 'absent' } },
      ],
      port,
      { ...options(), dryRun: true },
    )
    expect(report.diverged).toEqual([y])
  })
})
describe('forkEntries', () => {
  it('复制目标之前的有效消息与权限条目（去掉 runId，首条 fork_origin）；Run 生命周期、执行记录与快照引用不复制', () => {
    const entries = seqd([
      { kind: 'permission_mode', runId: null, payload: { mode: 'accept-edits' } }, // 1
      runStart('r1'), // 2
      user('one', 'r1'), // 3
      reply('a1', 'r1'), // 4
      backup(3, '/w/a.txt', { blob: H('0') }, 'r1'), // 5
      exec('w1', 'write', 'r1'), // 6
      runEnd('r1'), // 7
      runStart('r2'), // 8
      user('discarded', 'r2'), // 9
      reply('a2', 'r2'), // 10
      runEnd('r2'), // 11
      rewind(9), // 12
      { kind: 'permission_rule', runId: null, payload: { op: 'add', rule: { behavior: 'allow', tool: 'Bash', content: 'ls' } } }, // 13
      runStart('r3'), // 14
      user('two', 'r3'), // 15
      reply('a3', 'r3'), // 16
      runEnd('r3'), // 17
    ])
    const fork = forkEntries(entries, 'source-1', 15)
    expect(fork.text).toBe('two')
    expect(fork.entries).toEqual([
      { kind: 'fork_origin', payload: { sessionId: 'source-1', seq: 15 } },
      { kind: 'permission_mode', payload: { mode: 'accept-edits' } },
      { kind: 'message', payload: entries[2]!.payload },
      { kind: 'message', payload: entries[3]!.payload },
      { kind: 'permission_rule', payload: entries[12]!.payload },
    ])
    expect(() => forkEntries(entries, 'source-1', 9)).toThrow(RewindTargetError)
  })

  it('经过压缩：复制最后一个 compaction 与其保留的消息（不复制被摘要替代的），新 Session 的模型上下文与原 Session 相同', () => {
    const compaction = (firstKeptSeq: number): Row => ({
      kind: 'compaction',
      runId: 'r2',
      payload: { summary: 'S', firstKeptSeq, tokensBefore: 10, trigger: 'auto', readFiles: [], modifiedFiles: [] },
    })
    const entries = seqd([
      { kind: 'permission_mode', runId: null, payload: { mode: 'default' } }, // 1
      user('one', 'r1'), // 2
      reply('a1', 'r1'), // 3
      user('two', 'r2'), // 4
      compaction(4), // 5
      reply('a2', 'r2'), // 6
      user('three', 'r3'), // 7
      reply('a3', 'r3'), // 8
    ])
    const fork = forkEntries(entries, 'source-1', 7)
    expect(fork.entries.map((e) => e.kind)).toEqual(['fork_origin', 'permission_mode', 'message', 'message', 'compaction'])
    const forked = seqd(fork.entries.map((e) => ({ ...e, runId: null })) as Row[])
    expect(texts(forked)).toEqual(texts(entries.filter((e) => e.seq < 7)))
    expect(texts(forked)[0]).toContain('<summary>\nS\n</summary>')
    // 目标在压缩之前：没有 compaction，复制原历史。
    expect(forkEntries(entries, 'source-1', 4).entries.map((e) => e.kind)).toEqual(['fork_origin', 'permission_mode', 'message', 'message'])
  })
})
