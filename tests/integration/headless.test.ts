// 无界面运行（ADR 0019，docs/subsystems/headless.md）：源码入口 + faux 模型。stream-json 每行可被 ServerMessage 与条目 schema 校验、最后一行
// result；text 只打印最终文本；--session 继续；Workspace 不在库中时登记；参数错误 4；SIGTERM 中止并以 2 退出；日志只写文件。
// 新的输出通道 stdout 的秘密总闸见 secrets-gate-headless.test.ts；不新增读取根（Workspace 与 Sidecar 相同）。
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { Value } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { ServerMessage, SessionEntry } from '@coko/protocol'
import { writeFile } from 'node:fs/promises'
import { customProvider, fauxScript, pollUntil, sidecarDirs, tempDir } from './sidecar-harness.ts'
import { baseArgs, dbEntries, dbRows, headlessLog, lines, runHeadless, spawnHeadless } from './headless-harness.ts'

const bash = (id: string, command: string) => ({ type: 'toolCall', name: 'bash', id, arguments: { command } })

async function setup(responses: unknown[]) {
  const root = await realpath(await tempDir())
  const dirs = await sidecarDirs()
  const script = await fauxScript(await tempDir(), { responses })
  return { root, dirs, env: { COKO_FAUX_SCRIPT: script } }
}

describe('headless', { timeout: 120_000 }, () => {
  it('stream-json：每行是 ServerMessage（条目合 schema），最后一行 result（status、sessionId、runId、usage、text），退出 0；Workspace 登记', async () => {
    const h = await setup([
      {
        content: [
          { type: 'text', text: 'listing' },
          { type: 'toolCall', name: 'ls', id: 'l1', arguments: { path: '.' } },
        ],
        usage: { input: 10, output: 4 },
      },
      { content: 'all done', usage: { input: 20, output: 6, cacheRead: 2 } },
    ])
    const out = await runHeadless(h.dirs, baseArgs(h.dirs, '--workspace', h.root, '--prompt', 'list files', '--output', 'stream-json'), h.env)
    expect(out).toMatchObject({ code: 0 })
    const parsed = lines(out.stdout)
    const result = parsed.at(-1)!
    const messages = parsed.slice(0, -1)
    expect(messages.length).toBeGreaterThan(5)
    expect(messages.filter((m) => !Value.Check(ServerMessage, m))).toEqual([])
    expect(messages.filter((m) => m.type === 'entry' && !Value.Check(SessionEntry, m.entry))).toEqual([])
    const sessionId = result.sessionId as string
    const runId = result.runId as string
    expect(result).toEqual({
      type: 'result',
      status: 'completed',
      sessionId,
      runId,
      text: 'all done',
      // 两次请求的 usage 之和（faux 未定价时 cost 为 0）。
      usage: { input: 30, output: 10, cacheRead: 2, cacheWrite: 0, total: 42, cost: 0 },
      durationMs: expect.any(Number),
    })
    const kinds = messages.flatMap((m) => (m.type === 'entry' ? [(m.entry as { kind: string }).kind] : []))
    expect(kinds).toEqual(expect.arrayContaining(['run_start', 'message', 'model_request', 'run_end']))
    expect(messages.filter((m) => m.type === 'progress').map((m) => (m.event as { type: string }).type)).toEqual(
      expect.arrayContaining(['run_start', 'tool_start', 'tool_end', 'run_end']),
    )
    expect(messages.every((m) => m.sessionId === sessionId)).toBe(true)
    // 读回：Workspace 已登记为该目录，条目与输出一致。
    expect(dbRows(h.dirs, 'SELECT path FROM workspaces')).toEqual([{ path: h.root }])
    expect(dbEntries(h.dirs, sessionId).find((e) => e.kind === 'run_end')?.payload).toEqual({ status: 'completed' })
    expect(messages.filter((m) => m.type === 'entry').length).toBe(dbEntries(h.dirs, sessionId).length - 1) // permission_mode 在订阅之前
  })

  it('text 只打印最终文本；--session 继续已有会话（第二次的请求含第一次的对话），json 只有一行 result', async () => {
    // 每个 headless 进程的 faux 队列从头开始：以 match 区分两次运行。
    const h = await setup([
      { match: 'one', content: 'first answer' },
      { match: 'two', content: 'second answer' },
    ])
    const first = await runHeadless(h.dirs, baseArgs(h.dirs, '--workspace', h.root, '--prompt', 'one'), h.env)
    expect([first.code, first.stdout]).toEqual([0, 'first answer\n'])
    const sessionId = dbRows(h.dirs, 'SELECT id FROM sessions')[0]!.id as string
    const second = await runHeadless(h.dirs, baseArgs(h.dirs, '--session', sessionId, '--prompt', 'two', '--output', 'json'), h.env)
    expect(second).toMatchObject({ code: 0 })
    expect(lines(second.stdout)).toEqual([expect.objectContaining({ type: 'result', status: 'completed', sessionId, text: 'second answer' })])
    expect(dbRows(h.dirs, 'SELECT id FROM sessions')).toHaveLength(1)
    const users = dbEntries(h.dirs, sessionId).filter((e) => e.kind === 'message' && e.payload.role === 'user')
    expect(users.map((u) => JSON.stringify(u.payload.content))).toEqual([expect.stringContaining('one'), expect.stringContaining('two')])
  })

  it.each([
    ['缺 --data-dir', ['--workspace', '/tmp', '--prompt', 'x']],
    ['未知参数', ['--bogus']],
    ['同时给 --prompt 与 --prompt-file', ['--prompt', 'x', '--prompt-file', 'y']],
    ['--output 不合法', ['--output', 'xml']],
    ['--model 形状不对', ['--model', 'nope']],
  ])('参数错误（%s）：退出 4，stdout 为空，stderr 有说明', async (_name, extra) => {
    const dirs = await sidecarDirs()
    const args = extra[0] === '--workspace' ? extra : baseArgs(dirs, '--workspace', '/tmp', ...(extra.includes('--prompt') ? [] : ['--prompt', 'x']), ...extra)
    const out = await runHeadless(dirs, args)
    expect([out.code, out.stdout]).toEqual([4, ''])
    expect(out.stderr).toMatch(/coko headless: .+\nUsage:/)
  })

  it('启动后的参数错误（--session 不存在、Workspace 不存在）：退出 4，json 输出为 failed', async () => {
    const h = await setup([])
    const missingSession = await runHeadless(h.dirs, baseArgs(h.dirs, '--session', 'nope', '--prompt', 'x', '--output', 'json'), h.env)
    expect(missingSession.code).toBe(4)
    expect(lines(missingSession.stdout)).toEqual([
      expect.objectContaining({ status: 'failed', error: { code: 'not-found', message: 'Session nope not found' } }),
    ])
    const missingDir = await runHeadless(h.dirs, baseArgs(h.dirs, '--workspace', join(h.root, 'nope'), '--prompt', 'x'), h.env)
    expect([missingDir.code, missingDir.stdout]).toEqual([4, ''])
  })

  it('SIGTERM：中止 Run，等待 run_end，以 2 退出；result 为 aborted', async () => {
    const h = await setup([{ content: [bash('b1', 'sleep 30')] }, { content: 'never' }])
    const run = spawnHeadless(
      h.dirs,
      baseArgs(h.dirs, '--workspace', h.root, '--prompt', 'wait', '--output', 'stream-json', '--permission-mode', 'full-access'),
      h.env,
    )
    await pollUntil(() => run.stdout().includes('"tool_start"'), { timeoutMs: 60_000, what: 'tool_start on stdout' })
    run.child.kill('SIGTERM')
    expect(await run.exited).toEqual({ code: 2, signal: null })
    expect(lines(run.stdout()).at(-1)).toMatchObject({ type: 'result', status: 'aborted' })
    const sessionId = lines(run.stdout()).at(-1)!.sessionId as string
    expect(dbEntries(h.dirs, sessionId).at(-1)).toMatchObject({ kind: 'run_end', payload: { status: 'aborted' } })
  })

  it('日志写 <log-dir>/headless.jsonl，不写 stdout；--log-dir 缺省为 <data-dir>/logs', async () => {
    const h = await setup([{ content: 'quiet' }])
    const out = await runHeadless(h.dirs, ['--data-dir', h.dirs.dataDir, '--workspace', h.root, '--prompt', 'x'], h.env)
    expect([out.code, out.stdout]).toEqual([0, 'quiet\n'])
    const log = await headlessLog({ ...h.dirs, logDir: join(h.dirs.dataDir, 'logs') })
    expect(log.map((r) => r.message)).toEqual(expect.arrayContaining(['headless run started', 'faux provider enabled for tests']))
    expect(out.stderr).not.toContain('headless run started')
  })
})

describe('headless：--provider-config（ADR 0019）', { timeout: 120_000 }, () => {
  const config = async (body: unknown) => {
    const path = join(await tempDir(), 'providers.json')
    await writeFile(path, JSON.stringify(body))
    return path
  }
  const unreachable = 'http://127.0.0.1:9/v1'

  it('一个事务：第二个 Provider 无效时退出 4，库中没有任何 Provider（先红：逐个写入时第一个会留下）', async () => {
    const root = await realpath(await tempDir())
    const dirs = await sidecarDirs()
    const bad = {
      ...customProvider('second', unreachable, ['m']),
      models: [{ ...customProvider('x', unreachable, ['m']).models[0]!, maxTokens: 10, contextWindow: 5 }],
    }
    const path = await config({ providers: [customProvider('first', unreachable, ['m']), bad] })
    const out = await runHeadless(dirs, baseArgs(dirs, '--workspace', root, '--prompt', 'x', '--provider-config', path, '--output', 'json'))
    expect(out.code).toBe(4)
    expect(lines(out.stdout)).toEqual([expect.objectContaining({ status: 'failed', error: expect.objectContaining({ code: 'bad-request' }) })])
    expect(dbRows(dirs, 'SELECT id FROM providers')).toEqual([])
  })

  it('文件带 apiKey 字段：退出 4，消息不含该值，库中没有 Provider', async () => {
    const root = await realpath(await tempDir())
    const dirs = await sidecarDirs()
    const path = await config({ providers: [{ ...customProvider('first', unreachable, ['m']), apiKey: 'sk-in-the-file-1234567890' }] })
    const out = await runHeadless(dirs, baseArgs(dirs, '--workspace', root, '--prompt', 'x', '--provider-config', path))
    expect([out.code, out.stdout]).toEqual([4, ''])
    expect(out.stderr).toContain('must not contain secrets')
    expect(out.stderr).not.toContain('sk-in-the-file')
    expect(dbRows(dirs, 'SELECT id FROM providers')).toEqual([])
  })

  it('缺 COKO_CREDENTIAL_<ID>：result failed、错误码 no-credential，退出 1；Provider 已写入且库中没有密钥', async () => {
    const root = await realpath(await tempDir())
    const dirs = await sidecarDirs()
    const path = await config({ providers: [customProvider('my-gw', unreachable, ['m'])], defaultModel: 'my-gw/m' })
    const out = await runHeadless(dirs, baseArgs(dirs, '--workspace', root, '--prompt', 'x', '--provider-config', path, '--output', 'json'))
    expect(out).toMatchObject({ code: 1 })
    expect(lines(out.stdout)).toEqual([
      expect.objectContaining({ status: 'failed', error: { code: 'no-credential', message: 'No API key for provider my-gw: set COKO_CREDENTIAL_MY_GW' } }),
    ])
    expect(dbRows(dirs, 'SELECT id FROM providers')).toEqual([{ id: 'my-gw' }])
    expect(dbRows(dirs, 'SELECT provider_id FROM provider_credentials')).toEqual([])
  })
})
