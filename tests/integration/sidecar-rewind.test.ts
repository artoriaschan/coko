// 回退与分叉（ADR 0006）：真实 Sidecar（faux 模型）经协议驱动。断言 Workspace 文件内容（逐字节）、读回的条目、
// faux 记录的模型请求上下文与 409 前置条件；SIGKILL 前以已提交条目或文件内容同步，不用固定 sleep。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval, type SidecarDirs, type Stream } from './sidecar-harness.ts'

async function boot(options: { mode?: string; responses: unknown[]; requestLog?: string; env?: Record<string, string>; dirs?: SidecarDirs; root?: string }) {
  const root = options.root ?? (await realpath(await tempDir()))
  const dirs = options.dirs ?? (await sidecarDirs())
  const script = await fauxScript(root, { responses: options.responses, ...(options.requestLog ? { requestLog: options.requestLog } : {}) }, '.faux.json')
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...options.env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = await api.post(API_ROUTES.workspaces, { path: root })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id, title: 'Plan' })).body.id as string
  if (options.mode) {
    const changed = await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: options.mode })
    if (changed.status !== 200) throw new Error('permission mode change failed: ' + changed.status)
  }
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  return { root, dirs, sidecar, cookie, api, sessionId, stream, workspaceId: workspace.body.id as string }
}

type Api = Awaited<ReturnType<typeof boot>>['api']
const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const edit = (id: string, path: string, oldText: string, newText: string) => call('edit', id, { path, edits: [{ oldText, newText }] })
const write = (id: string, path: string, content: string) => call('write', id, { path, content })
const runEnds = (stream: Stream, sessionId: string, n: number) =>
  stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)
const entriesOf = async (api: Api, sessionId: string) => (await api.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
const role = (e: SessionEntryRecord) => (e.payload as { role?: string }).role
const textOf = (payload: unknown) => {
  const content = (payload as { content?: unknown }).content
  return typeof content === 'string' ? content : ((content as { type: string; text?: string }[]) ?? []).map((b) => b.text ?? '').join('')
}
const userSeqs = (entries: SessionEntryRecord[]) => entries.filter((e) => e.kind === 'message' && role(e) === 'user').map((e) => e.seq)
const absent = (path: string) =>
  stat(path).then(
    () => false,
    () => true,
  )
/** faux 记录的第 n 次模型请求（从 0 起）中各消息的 role 与文本（不含系统提示）。 */
async function request(log: string, n: number): Promise<string[]> {
  const lines = (await readFile(log, 'utf8')).split('\n').filter(Boolean)
  return (JSON.parse(lines[n]!) as { role: string; content: unknown }[]).filter((m) => m.role !== 'system').map((m) => `${m.role}:${textOf(m)}`)
}
const send = async (api: Api, stream: Stream, sessionId: string, text: string, n: number) => {
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
  await runEnds(stream, sessionId, n)
}

describe('回退与分叉', () => {
  it(
    '三条消息各 edit 同一文件 → 回退代码到第二条：文件等于第一条 Run 之后的内容，其后新建的文件被删除，未追踪的文件不变；dry-run 不改文件并标出 Agent 之外的改动',
    { timeout: 60_000 },
    async () => {
      const { root, api, sessionId, stream } = await boot({
        mode: 'accept-edits',
        responses: [
          { content: [edit('e1', 'notes.txt', 'v0', 'v1')] },
          { content: 'one done' },
          { content: [edit('e2', 'notes.txt', 'v1', 'v2'), write('w2', 'src/created.txt', 'created in two\n')] },
          { content: 'two done' },
          { content: [edit('e3', 'notes.txt', 'v2', 'v3')] },
          { content: 'three done' },
        ],
      })
      const notes = join(root, 'notes.txt')
      const created = join(root, 'src/created.txt')
      const keep = join(root, 'keep.bin')
      const keepBytes = randomBytes(4096)
      await writeFile(notes, 'v0\n\u00e9\n')
      await writeFile(keep, keepBytes)
      await send(api, stream, sessionId, 'one', 1)
      const afterFirst = await readFile(notes)
      await send(api, stream, sessionId, 'two', 2)
      await send(api, stream, sessionId, 'three', 3)
      expect(await readFile(notes, 'utf8')).toBe('v3\n\u00e9\n')
      const entries = await entriesOf(api, sessionId)
      const [first, second, third] = userSeqs(entries)

      const checkpoints = (await api.get(checkpointPaths.sessionCheckpoints(sessionId))).body.checkpoints
      expect(checkpoints.map((c: { seq: number; text: string; paths: string[] }) => [c.seq, c.text, c.paths])).toEqual([
        [first, 'one', [notes, created]],
        [second, 'two', [notes, created]],
        [third, 'three', [notes]],
      ])

      // dry-run：报告将恢复与删除的文件，不改任何文件、不提交条目。
      const dry = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: second, mode: 'code', dryRun: true })
      expect(dry.status).toBe(200)
      expect(dry.body).toEqual({
        targetSeq: second,
        mode: 'code',
        dryRun: true,
        text: 'two',
        restored: [notes],
        deleted: [created],
        diverged: [],
        untracked: [],
        outside: [],
        skipped: [],
      })
      expect(await readFile(notes, 'utf8')).toBe('v3\n\u00e9\n')
      expect(await readFile(created, 'utf8')).toBe('created in two\n')

      // 在 Agent 之外改动 notes.txt：出现在 diverged，dry-run 仍不改它。
      await writeFile(notes, 'v3\n\u00e9\nedited by the user\n')
      const dry2 = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: second, mode: 'code', dryRun: true })
      expect(dry2.body).toMatchObject({ restored: [notes], deleted: [created], diverged: [notes] })
      expect(await readFile(notes, 'utf8')).toBe('v3\n\u00e9\nedited by the user\n')

      const done = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: second, mode: 'code' })
      expect(done.body).toEqual({
        targetSeq: second,
        mode: 'code',
        dryRun: false,
        text: 'two',
        restored: [notes],
        deleted: [created],
        diverged: [notes],
        untracked: [],
        outside: [],
        skipped: [],
      })
      expect(Buffer.compare(await readFile(notes), afterFirst)).toBe(0)
      expect(await absent(created)).toBe(true)
      expect(Buffer.compare(await readFile(keep), keepBytes)).toBe(0)
      // 只回退代码：不提交 rewind 条目。
      const after = await entriesOf(api, sessionId)
      expect(after).toHaveLength(entries.length)
      expect(stream.invalidEntries).toEqual([])
    },
  )

  it('回退对话 → 下一次模型请求不含被回退的消息，条目仍可读到；both 同时回退文件与对话', { timeout: 60_000 }, async () => {
    const root = await realpath(await tempDir())
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const { api, sessionId, stream } = await boot({
      root,
      mode: 'accept-edits',
      requestLog,
      responses: [
        { content: [write('w1', 'a.txt', 'A1')] },
        { content: 'alpha done' },
        { content: [write('w2', 'a.txt', 'A2')] },
        { content: 'beta done' },
        { content: 'gamma done' },
        { content: 'delta done' },
      ],
    })
    const a = join(root, 'a.txt')
    await send(api, stream, sessionId, 'alpha', 1)
    await send(api, stream, sessionId, 'beta', 2)
    const [, beta] = userSeqs(await entriesOf(api, sessionId))

    const rewound = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: beta, mode: 'conversation' })
    expect(rewound.body).toMatchObject({ mode: 'conversation', text: 'beta', restored: [], deleted: [] })
    // 只回退对话：文件不动；rewind 条目已提交，被回退的消息仍在详情中。
    expect(await readFile(a, 'utf8')).toBe('A2')
    const detail = await api.get(apiPaths.session(sessionId))
    expect(detail.body.session).toMatchObject({ activity: 'idle', running: false })
    const rewindEntry = (detail.body.entries as SessionEntryRecord[]).at(-1)!
    expect(rewindEntry).toMatchObject({ kind: 'rewind', payload: { targetSeq: beta } })
    expect((detail.body.entries as SessionEntryRecord[]).some((e) => role(e) === 'user' && textOf(e.payload) === 'beta')).toBe(true)
    // 回退的目标已不在有效上下文中。
    expect((await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: beta, mode: 'conversation' })).status).toBe(400)

    await send(api, stream, sessionId, 'gamma', 3)
    expect(await request(requestLog, 4)).toEqual(['user:alpha', 'assistant:', 'toolResult:Successfully wrote to a.txt', 'assistant:alpha done', 'user:gamma'])

    // both：回到 alpha 之前——a.txt 原先不存在，被删除；下一次请求只有新消息。
    const [alpha] = userSeqs(await entriesOf(api, sessionId))
    const both = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: alpha, mode: 'both' })
    expect(both.body).toMatchObject({ mode: 'both', text: 'alpha', restored: [], deleted: [a], diverged: [] })
    expect(await absent(a)).toBe(true)
    await send(api, stream, sessionId, 'delta', 4)
    expect(await request(requestLog, 5)).toEqual(['user:delta'])
    expect(stream.invalidEntries).toEqual([])
  })

  it('分叉 → 新 Session 首条 fork_origin、条目为目标之前的有效条目，原 Session 条目数不变', { timeout: 60_000 }, async () => {
    const root = await realpath(await tempDir())
    const requestLog = join(root, 'requests.jsonl')
    await writeFile(requestLog, '')
    const { api, sessionId, stream } = await boot({
      root,
      requestLog,
      responses: [{ content: 'r1' }, { content: 'r2' }, { content: 'r3' }],
    })
    await send(api, stream, sessionId, 'first', 1)
    await send(api, stream, sessionId, 'second', 2)
    const source = await entriesOf(api, sessionId)
    const [, second] = userSeqs(source)
    // 目标不是用户消息：400。
    expect((await api.post(checkpointPaths.sessionFork(sessionId), { targetSeq: second! + 1 })).status).toBe(400)

    // 标题由界面按当前语言生成后传入；不传时沿用原标题（Sidecar 不写本地化文案）。
    const forked = await api.post(checkpointPaths.sessionFork(sessionId), { targetSeq: second, title: 'Plan（分叉）' })
    expect(forked.status).toBe(201)
    expect(forked.body.text).toBe('second')
    const forkId = forked.body.sessionId as string
    expect(forkId).not.toBe(sessionId)
    const untitled = (await api.post(checkpointPaths.sessionFork(sessionId), { targetSeq: second })).body.sessionId as string
    const sessions = (await api.get(API_ROUTES.sessions)).body.sessions as { id: string; title: string; activity: string }[]
    expect(sessions.find((s) => s.id === forkId)).toMatchObject({ title: 'Plan（分叉）', activity: 'idle' })
    expect(sessions.find((s) => s.id === untitled)).toMatchObject({ title: 'Plan' })

    const copy = await entriesOf(api, forkId)
    expect(copy[0]).toMatchObject({ seq: 1, kind: 'fork_origin', runId: null, payload: { sessionId, seq: second } })
    const expected = source.filter((e) => e.seq < second! && (e.kind === 'message' || e.kind === 'permission_mode' || e.kind === 'permission_rule'))
    expect(copy.slice(1).map((e) => [e.kind, e.runId, e.payload])).toEqual(expected.map((e) => [e.kind, null, e.payload]))
    expect(await entriesOf(api, sessionId)).toHaveLength(source.length)

    // 新 Session 的 Run 只带分叉前的上下文；原 Session 仍不变。
    stream.send({ type: 'subscribe', sessionId: forkId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === forkId)
    await send(api, stream, forkId, 'second, differently', 1)
    expect(await request(requestLog, 2)).toEqual(['user:first', 'assistant:r1', 'user:second, differently'])
    expect(await entriesOf(api, sessionId)).toHaveLength(source.length)
    expect(stream.invalidEntries).toEqual([])
  })

  it('Run 进行中（等待审批）回退、dry-run 与分叉 → 409 session-busy；Run 结束后可用', { timeout: 60_000 }, async () => {
    const { api, sessionId, stream } = await boot({ responses: [{ content: 'ok' }, { content: [write('w1', 'x.txt', 'x')] }, { content: 'never' }] })
    await send(api, stream, sessionId, 'first', 1)
    const [first] = userSeqs(await entriesOf(api, sessionId))
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'write x' })
    const request = await waitApproval(stream, sessionId)
    const busy = { status: 409, body: { error: { code: 'session-busy' } } }
    expect(await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: first, mode: 'both' })).toMatchObject(busy)
    expect(await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: first, mode: 'code', dryRun: true })).toMatchObject(busy)
    expect(await api.post(checkpointPaths.sessionFork(sessionId), { targetSeq: first })).toMatchObject(busy)
    expect((await api.post(apiPaths.sessionApproval(sessionId, request.requestId), { decision: 'deny' })).status).toBe(204)
    await runEnds(stream, sessionId, 2)
    expect((await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: first, mode: 'both', dryRun: true })).status).toBe(200)
    expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
  })

  it('有未回答的结果确认 → 回退与分叉 409 confirmation-pending', { timeout: 60_000 }, async () => {
    const first = await boot({ mode: 'full-access', responses: [{ content: [call('bash', 'b1', { command: 'sleep 30' })] }] })
    await first.api.post(apiPaths.sessionMessages(first.sessionId), { text: 'run it' })
    await first.stream.waitFor((m) => m.type === 'entry' && m.sessionId === first.sessionId && m.entry.kind === 'tool_exec')
    first.sidecar.child.kill('SIGKILL')
    await first.sidecar.exited
    const sidecar = await startSidecar({ dirs: first.dirs, env: { COKO_FAUX_SCRIPT: join(first.root, '.faux.json') } })
    const api = client(sidecar, await exchange(sidecar))
    const [target] = userSeqs(await entriesOf(api, first.sessionId))
    const pending = { status: 409, body: { error: { code: 'confirmation-pending' } } }
    expect(await api.post(checkpointPaths.sessionRewind(first.sessionId), { targetSeq: target, mode: 'conversation' })).toMatchObject(pending)
    expect(await api.post(checkpointPaths.sessionFork(first.sessionId), { targetSeq: target })).toMatchObject(pending)
  })

  it('write 执行后、file_change 提交前被杀：恢复补齐的结果没有 file_change，回退代码不把该路径误报为 Agent 之外改过', { timeout: 60_000 }, async () => {
    const env = { COKO_TEST_TOOLS: '1', COKO_TEST_HOLD_AFTER_TOOL: 'write', COKO_TEST_HOLD_BEFORE_CHECKPOINT: '1' }
    const first = await boot({ mode: 'accept-edits', env, responses: [{ content: [write('w1', 'notes.txt', 'written before the crash\n')] }] })
    const notes = join(first.root, 'notes.txt')
    await writeFile(notes, 'original\n')
    await first.api.post(apiPaths.sessionMessages(first.sessionId), { text: 'write notes' })
    await expect.poll(() => readFile(notes, 'utf8'), { timeout: 20_000 }).toBe('written before the crash\n')
    first.sidecar.child.kill('SIGKILL')
    await first.sidecar.exited

    const sidecar = await startSidecar({ dirs: first.dirs, env: { COKO_FAUX_SCRIPT: join(first.root, '.faux.json') } })
    const api = client(sidecar, await exchange(sidecar))
    const entries = await entriesOf(api, first.sessionId)
    const kinds = entries.map((e) => (e.kind === 'message' ? role(e) : e.kind))
    expect(kinds.slice(2)).toEqual(['run_start', 'user', 'assistant', 'file_backup', 'tool_exec', 'toolResult', 'run_end'])
    expect(textOf(entries.find((e) => role(e) === 'toolResult')!.payload)).toMatch(/^Applied: /)
    const [target] = userSeqs(entries)

    const dry = await api.post(checkpointPaths.sessionRewind(first.sessionId), { targetSeq: target, mode: 'code', dryRun: true })
    expect(dry.body).toMatchObject({ restored: [notes], deleted: [], diverged: [], untracked: [] })
    expect((await api.post(checkpointPaths.sessionRewind(first.sessionId), { targetSeq: target, mode: 'code' })).status).toBe(200)
    expect(await readFile(notes, 'utf8')).toBe('original\n')
  })

  it('回退代码：Workspace 外的文件单独列在 outside；父目录被替换为符号链接的路径列在 skipped 且链接目标不变', { timeout: 60_000 }, async () => {
    const outsideDir = await realpath(await tempDir('coko-rewind-outside-'))
    const rc = join(outsideDir, 'rc')
    await writeFile(rc, 'rc before\n')
    const { root, api, sessionId, stream } = await boot({
      mode: 'full-access',
      responses: [{ content: [write('w1', rc, 'rc by coko\n'), write('w2', 'dir/d.txt', 'd by coko\n')] }, { content: 'done' }],
    })
    await mkdir(join(root, 'dir'))
    await writeFile(join(root, 'dir', 'd.txt'), 'd before\n')
    await send(api, stream, sessionId, 'change them', 1)
    expect(await readFile(rc, 'utf8')).toBe('rc by coko\n')
    // 备份之后 Agent 之外把 dir 换成指向别处的链接（bash 不追踪）。
    const victimDir = await realpath(await tempDir('coko-rewind-victim-'))
    await writeFile(join(victimDir, 'd.txt'), 'not yours\n')
    await rename(join(root, 'dir'), join(root, 'dir-moved'))
    await symlink(victimDir, join(root, 'dir'))
    const [target] = userSeqs(await entriesOf(api, sessionId))
    const dry = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: target, mode: 'code', dryRun: true })
    expect(dry.body).toMatchObject({ restored: [rc], outside: [rc], skipped: [join(root, 'dir', 'd.txt')] })
    const done = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: target, mode: 'code' })
    expect(done.body).toMatchObject({ restored: [rc], outside: [rc], skipped: [join(root, 'dir', 'd.txt')] })
    expect(await readFile(rc, 'utf8')).toBe('rc before\n')
    expect(await readFile(join(victimDir, 'd.txt'), 'utf8')).toBe('not yours\n')
  })
})
