// 登记 Workspace → 新建 Session → 提交消息 → WebSocket 收到 progress 与 entry；停止、重启读回与 afterSeq 补齐。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, type ServerMessage, type SessionEntry } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

async function boot(dirs: Awaited<ReturnType<typeof sidecarDirs>>, script?: string) {
  const sidecar = await startSidecar({ dirs, ...(script ? { env: { COKO_FAUX_SCRIPT: script } } : {}) })
  const cookie = await exchange(sidecar)
  return { sidecar, cookie, api: client(sidecar, cookie) }
}

async function newSession(api: ReturnType<typeof client>, workspacePath: string) {
  const workspace = await api.post(API_ROUTES.workspaces, { path: workspacePath })
  expect(workspace.status).toBe(201)
  const session = await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })
  expect(session.status).toBe(201)
  return { workspaceId: workspace.body.id as string, sessionId: session.body.id as string, model: session.body.model }
}

const role = (entry: SessionEntry) => (entry.payload as { role?: string }).role

describe('Session 协议', () => {
  it('提交消息后收到 progress 与按 seq 递增的 entry，Agent 写入的文件存在', async () => {
    const root = await tempDir()
    const workspacePath = join(root, 'ws')
    await import('node:fs/promises').then((fs) => fs.mkdir(workspacePath))
    const script = await fauxScript(root, {
      responses: [
        {
          content: [
            { type: 'text', text: 'Writing the file.' },
            { type: 'toolCall', name: 'write', id: 'w1', arguments: { path: 'notes/hello.txt', content: 'hello from coko\n' } },
          ],
        },
        { content: 'Done.' },
      ],
    })
    const { sidecar, cookie, api } = await boot(await sidecarDirs(), script)
    const { sessionId, model } = await newSession(api, workspacePath)
    expect(model).toEqual({ providerId: 'faux', modelId: 'faux-1' })

    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed')

    const submitted = await api.post(apiPaths.sessionMessages(sessionId), { text: 'write a greeting' })
    expect(submitted.status).toBe(202)
    const { runId } = submitted.body as { runId: string }
    await stream.waitFor(isRunEnd(sessionId))

    const progress = stream.messages.filter((m): m is Extract<ServerMessage, { type: 'progress' }> => m.type === 'progress')
    expect(progress.every((m) => m.runId === runId)).toBe(true)
    const types = progress.map((m) => m.event.type)
    expect(types[0]).toBe('run_start')
    expect(types).toContain('assistant_delta')
    expect(types.indexOf('tool_start')).toBeLessThan(types.indexOf('tool_end'))
    const text = progress.flatMap((m) => (m.event.type === 'assistant_delta' && m.event.kind === 'text' ? [m.event.delta] : [])).join('')
    expect(text).toBe('Writing the file.Done.')

    const entries = stream.entries(sessionId)
    expect(entries.map((e) => e.seq)).toEqual(entries.map((_, i) => i + 1))
    expect(entries.map((e) => (e.kind === 'message' ? role(e) : e.kind))).toEqual(['user', 'assistant', 'toolResult', 'assistant', 'run_end'])
    expect(entries.every((e) => e.runId === runId)).toBe(true)
    expect(entries.at(-1)?.payload).toEqual({ status: 'completed' })
    expect(stream.invalid).toEqual([])

    expect(await readFile(join(workspacePath, 'notes/hello.txt'), 'utf8')).toBe('hello from coko\n')
    const detail = await api.get(apiPaths.session(sessionId))
    expect(detail.body.entries).toEqual(entries)
    expect(detail.body.session.running).toBe(false)
  })

  it('停止 Run 后收到取消条目；重启 Sidecar 后条目完整读回；afterSeq 只补发缺失条目', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, {
      responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'sleep 30' } }] }, { content: 'should not be used' }],
    })
    const first = await boot(dirs, script)
    const { sessionId } = await newSession(first.api, root)
    const stream = await connect(first.sidecar, first.cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })

    expect((await first.api.post(apiPaths.sessionMessages(sessionId), { text: 'wait' })).status).toBe(202)
    await stream.waitFor((m) => m.type === 'progress' && m.event.type === 'tool_start')
    expect((await first.api.get(apiPaths.session(sessionId))).body.session.running).toBe(true)
    expect((await first.api.post(apiPaths.sessionMessages(sessionId), { text: 'again' })).body).toMatchObject({ error: { code: 'run-in-progress' } })
    first.sidecar.send({ type: 'inspect-quit', requestId: 1 })
    expect(await first.sidecar.waitMessage('inspect-quit.result')).toEqual({ type: 'inspect-quit.result', requestId: 1, activeRuns: 1 })

    const started = Date.now()
    expect((await first.api.post(apiPaths.sessionAbort(sessionId))).body).toEqual({ aborted: true })
    const end = (await stream.waitFor(isRunEnd(sessionId))) as Extract<ServerMessage, { type: 'entry' }>
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(end.entry.payload).toEqual({ status: 'aborted' })
    expect((await first.api.post(apiPaths.sessionAbort(sessionId))).body).toEqual({ aborted: false })
    const before = (await first.api.get(apiPaths.session(sessionId))).body.entries as SessionEntry[]
    expect(before.map((e) => e.kind)).toContain('run_end')
    expect(await first.sidecar.stop()).toEqual({ code: 0, signal: null })

    const second = await boot(dirs)
    const after = await second.api.get(apiPaths.session(sessionId))
    expect(after.body.entries).toEqual(before)

    const resumed = await connect(second.sidecar, second.cookie)
    resumed.send({ type: 'subscribe', sessionId, afterSeq: 2 })
    const subscribed = await resumed.waitFor((m) => m.type === 'subscribed')
    expect(resumed.entries(sessionId)).toEqual(before.slice(2))
    expect(subscribed).toEqual({ type: 'subscribed', sessionId, lastSeq: before.length, running: false })
  })

  it('运行中收到 shutdown：Run 以取消结束并在关闭存储前提交，重启后可读回', async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const script = await fauxScript(root, { responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'sleep 30' } }] }] })
    const first = await boot(dirs, script)
    const { sessionId } = await newSession(first.api, root)
    const stream = await connect(first.sidecar, first.cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await first.api.post(apiPaths.sessionMessages(sessionId), { text: 'wait' })
    await stream.waitFor((m) => m.type === 'progress' && m.event.type === 'tool_start')
    expect(await first.sidecar.stop()).toEqual({ code: 0, signal: null })
    expect(await stream.closed).toBe(1001)

    const second = await boot(dirs)
    const entries = (await second.api.get(apiPaths.session(sessionId))).body.entries as SessionEntry[]
    expect(entries.at(-1)).toMatchObject({ kind: 'run_end', payload: { status: 'aborted' } })
  })

  it('订阅时 afterSeq 之后的条目与实时条目衔接，不重复也不遗漏', async () => {
    const root = await tempDir()
    const script = await fauxScript(root, { responses: [{ content: 'one' }, { content: 'two' }] })
    const { sidecar, cookie, api } = await boot(await sidecarDirs(), script)
    const { sessionId } = await newSession(api, root)
    const early = await connect(sidecar, cookie)
    early.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await early.waitFor((m) => m.type === 'subscribed')
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'first' })
    await early.waitFor(isRunEnd(sessionId))
    const firstRun = early.entries(sessionId).length

    // 第二个连接在第二个 Run 进行中订阅，从 afterSeq=1 开始补齐。
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'second' })
    const late = await connect(sidecar, cookie)
    late.send({ type: 'subscribe', sessionId, afterSeq: 1 })
    await early.waitFor((m) => m.type === 'entry' && m.entry.seq > firstRun && m.entry.kind === 'run_end')
    await late.waitFor((m) => m.type === 'entry' && m.entry.seq > firstRun && m.entry.kind === 'run_end')
    const all = early.entries(sessionId)
    expect(late.entries(sessionId)).toEqual(all.slice(1))
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1))
  })

  it('可重试错误的 retry 进度在推送前脱敏，与入库的错误文本使用同一脱敏', async () => {
    const root = await tempDir()
    const secret = 'sk-live1234567890abcdef'
    const script = await fauxScript(root, {
      responses: [
        { content: [], stopReason: 'error', errorMessage: `503 Service Unavailable for key ${secret}` },
        { content: [], stopReason: 'error', errorMessage: `invalid request for key ${secret}` },
      ],
    })
    const { sidecar, cookie, api } = await boot(await sidecarDirs(), script)
    const { sessionId } = await newSession(api, root)
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed')
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'hi' })
    const retry = await stream.waitFor((m) => m.type === 'progress' && m.event.type === 'retry')
    await stream.waitFor(isRunEnd(sessionId))
    expect(retry).toMatchObject({ event: { type: 'retry', attempt: 1, errorMessage: '503 Service Unavailable for key [REDACTED]' } })
    expect(JSON.stringify(stream.messages)).not.toContain(secret)
  })

  it('bash 子进程的环境剔除 COKO_* 与凭据形态的变量，保留 PATH 与 HOME', async () => {
    const root = await tempDir()
    const script = await fauxScript(root, {
      responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'e1', arguments: { command: 'env' } }] }, { content: 'done' }],
    })
    const secrets = {
      COKO_CREDENTIAL_MINE: 'coko-credential-value',
      OPENAI_API_KEY: 'openai-key-value',
      GITHUB_TOKEN: 'github-token-value',
      AWS_SECRET_ACCESS_KEY: 'aws-secret-value',
      CLIENT_SECRET: 'client-secret-value',
    }
    const sidecar = await startSidecar({ dirs: await sidecarDirs(), ipc: false, env: { COKO_FAUX_SCRIPT: script, ...secrets, KEEP_ME: 'visible-value' } })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const { sessionId } = await newSession(api, root)
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed')
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'print env' })
    await stream.waitFor(isRunEnd(sessionId))
    const result = stream.entries(sessionId).find((e) => role(e) === 'toolResult')
    const output = JSON.stringify(result?.payload)
    expect(output).toContain('KEEP_ME=visible-value')
    expect(output).toContain(`PATH=${process.env.PATH}`)
    expect(output).toContain(`HOME=${process.env.HOME}`)
    for (const [name, value] of Object.entries(secrets)) {
      expect(output).not.toContain(name)
      expect(output).not.toContain(value)
    }
    expect(output).not.toContain('COKO_FAUX_SCRIPT')
    expect(output).not.toContain('ELECTRON_RUN_AS_NODE')
  })

  it('没有模型时提交返回 model-not-configured；未知 Session 与非法订阅返回错误', async () => {
    const root = await tempDir()
    const { sidecar, cookie, api } = await boot(await sidecarDirs())
    const { sessionId, model } = await newSession(api, root)
    expect(model).toBeNull()
    expect(await api.post(apiPaths.sessionMessages(sessionId), { text: 'hi' })).toMatchObject({
      status: 409,
      body: { error: { code: 'model-not-configured' } },
    })
    expect((await api.get(apiPaths.session('missing'))).status).toBe(404)
    expect((await api.post(API_ROUTES.workspaces, { path: 'relative/dir' })).status).toBe(400)
    expect((await api.post(API_ROUTES.workspaces, { path: join(root, 'missing') })).status).toBe(400)
    expect((await api.post(API_ROUTES.sessions, { workspaceId: 'missing' })).status).toBe(404)
    const stream = await connect(sidecar, cookie)
    stream.send({ type: 'subscribe', sessionId: 'missing', afterSeq: 0 })
    stream.send({ type: 'nope' })
    await stream.waitFor((m) => m.type === 'error' && m.code === 'bad-request')
    expect(await stream.waitFor((m) => m.type === 'error' && m.code === 'not-found')).toMatchObject({ sessionId: 'missing' })
  })
})
