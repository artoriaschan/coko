// 命令与提示模板（票 04）：真实 Sidecar（faux 模型），夹具 tests/fixtures/commands 复制到临时 Workspace 与临时 COKO_HOME。
// 断言提交的条目（run_start → command → 展开后的 user message）、faux requestLog 中实际发给模型的文本与 GET /api/commands。
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, commandPaths, configPaths, permissionPaths, runPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

const fixtures = fileURLToPath(new URL('../fixtures/commands/', import.meta.url))

async function boot(responses: unknown[]) {
  const root = await tempDir()
  const workspaceDir = join(root, 'workspace')
  await cp(join(fixtures, 'workspace'), workspaceDir, { recursive: true })
  const dirs = await sidecarDirs()
  await cp(join(fixtures, 'coko-home'), dirs.cokoHome, { recursive: true })
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { responses, requestLog })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string; path: string }
  const newSession = async () => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    return sessionId
  }
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { role: string; content: unknown }[])
  return { sidecar, api, stream, workspace, workspaceDir, dirs, newSession, requests }
}

const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const textOf = (content: unknown) =>
  typeof content === 'string' ? content : (content as { type: string; text?: string }[]).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('')
const userTexts = (entries: SessionEntryRecord[]) => entries.filter((e) => kindOf(e) === 'user').map((e) => textOf((e.payload as { content: unknown }).content))
const sentUserTexts = (messages: { role: string; content: unknown }[]) => messages.filter((m) => m.role === 'user').map((m) => textOf(m.content))

describe('命令展开', () => {
  it('/review src → run_start、command（project）、展开后的 user message；模型只收到展开文本', async () => {
    const { api, stream, newSession, requests, sidecar } = await boot([{ content: 'reviewed' }])
    const sessionId = await newSession()
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '/review src' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(entries.map(kindOf)).toEqual(['permission_mode', 'run_start', 'command', 'user', 'assistant', 'run_end'])
    const runId = entries[1]!.runId
    expect(entries[2]).toMatchObject({ runId, payload: { name: 'review', args: 'src', source: 'project' } })
    const expanded = 'Review the code under src and report bugs. Focus: correctness.'
    expect(userTexts(entries)).toEqual([expanded])
    const sent = await requests()
    expect(sent).toHaveLength(1)
    expect(sentUserTexts(sent[0]!)).toEqual([expanded])
    expect(JSON.stringify(sent[0])).not.toContain('/review')
    expect(stream.invalidEntries).toEqual([])
    // 重新读回的条目相同。
    expect((await api.get(apiPaths.session(sessionId))).body.entries.map(kindOf)).toEqual(entries.map(kindOf))
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('用户级命令与命名空间；未知的 /xxx 与路径原样作为普通消息且没有 command 条目', async () => {
    const { api, stream, newSession, requests } = await boot([{ content: 'a' }, { content: 'b' }, { content: 'c' }])
    const sessionId = await newSession()
    const send = async (text: string, n: number) => {
      await api.post(apiPaths.sessionMessages(sessionId), { text })
      await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)
    }
    await send('/hello "Ada Lovelace"', 1)
    await send('/git:commit', 2)
    await send('/xxx do things', 3)
    const entries = stream.entries(sessionId)
    expect(entries.filter((e) => e.kind === 'command').map((e) => e.payload)).toEqual([
      { name: 'hello', args: '"Ada Lovelace"', source: 'user' },
      { name: 'git:commit', args: '', source: 'project' },
    ])
    expect(userTexts(entries)).toEqual([
      'Say hello to Ada Lovelace in one short sentence.',
      'Write a conventional commit message for the staged changes.',
      '/xxx do things',
    ])
    expect(sentUserTexts((await requests()).at(-1)!).at(-1)).toBe('/xxx do things')
  })

  it('steer 中的模板被展开：command 条目紧接在该 user message 之前', async () => {
    const sleep = { type: 'toolCall', name: 'bash', id: 'b1', arguments: { command: 'sleep 2 && echo slept' } }
    const { api, stream, newSession, requests } = await boot([{ content: [sleep] }, { content: 'adjusted' }])
    const sessionId = await newSession()
    expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'run it' })
    await stream.waitFor((m) => m.type === 'progress' && m.sessionId === sessionId && m.event.type === 'tool_start')
    expect((await api.post(runPaths.sessionSteer(sessionId), { text: '/hello Bob' })).status).toBe(204)
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(entries.map(kindOf).slice(2)).toEqual(['run_start', 'user', 'assistant', 'tool_exec', 'toolResult', 'command', 'user', 'assistant', 'run_end'])
    expect(entries.find((e) => e.kind === 'command')!.payload).toEqual({ name: 'hello', args: 'Bob', source: 'user' })
    expect(userTexts(entries)).toEqual(['run it', 'Say hello to Bob in one short sentence.'])
    const sent = await requests()
    expect(sentUserTexts(sent[1]!)).toEqual(['run it', 'Say hello to Bob in one short sentence.'])
  })

  it('commands.disabled 中的命令与 commands.enabled=false 时不展开', async () => {
    const { api, stream, newSession, workspace } = await boot([{ content: 'a' }, { content: 'b' }, { content: 'c' }])
    const sessionId = await newSession()
    const put = (values: unknown, expectedRevision: number) => api.put(configPaths.config, { values, expectedRevision })
    expect((await put({ commands: { disabled: ['review'] } }, 0)).status).toBe(200)
    const send = async (text: string, n: number) => {
      await api.post(apiPaths.sessionMessages(sessionId), { text })
      await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n)
    }
    await send('/review src', 1)
    await send('/hello Ann', 2)
    expect((await put({ commands: { enabled: false } }, 1)).status).toBe(200)
    await send('/hello Ann', 3)

    const entries = stream.entries(sessionId)
    expect(entries.filter((e) => e.kind === 'command').map((e) => (e.payload as { name: string }).name)).toEqual(['hello'])
    expect(userTexts(entries)).toEqual(['/review src', 'Say hello to Ann in one short sentence.', '/hello Ann'])
    const listed = (await api.get(`${commandPaths.commands}?workspaceId=${workspace.id}`)).body as { commands: { name: string; enabled: boolean }[] }
    // 停用的命令仍列出（enabled: false），供设置分区显示。
    expect(listed.commands.map((c) => [c.name, c.enabled])).toEqual([
      // 内置命令不受 commands.enabled 影响（/compact 是动作，不是提示模板）。
      ['compact', true],
      ['git:commit', false],
      ['review', false],
      ['hello', false],
    ])
  })
})

describe('GET /api/commands', () => {
  it('返回按来源分组的目录（项目 > 用户，遮蔽与格式错误记诊断）；sessionId 与 workspaceId 等价；缺参数 400、不存在 404', async () => {
    const { api, newSession, workspace, workspaceDir, dirs } = await boot([])
    const byWorkspace = await api.get(`${commandPaths.commands}?workspaceId=${workspace.id}`)
    expect(byWorkspace.status).toBe(200)
    expect(byWorkspace.body.commands).toEqual([
      // 内置命令随其动作接入列出（票 11 的 /compact）。
      { name: 'compact', description: 'Summarize earlier messages to free up context', argumentHint: '[instructions]', source: 'builtin', enabled: true },
      {
        name: 'git:commit',
        description: 'Write a conventional commit message for the staged changes.',
        source: 'project',
        path: join(workspaceDir, '.coko/commands/git/commit.md'),
        enabled: true,
      },
      {
        name: 'review',
        description: 'Review a path for bugs',
        argumentHint: '<path> [focus]',
        source: 'project',
        path: join(workspaceDir, '.coko/commands/review.md'),
        enabled: true,
      },
      { name: 'hello', description: 'Greet someone', argumentHint: '<name>', source: 'user', path: join(dirs.cokoHome, 'commands/hello.md'), enabled: true },
    ])
    expect(byWorkspace.body.diagnostics).toEqual([
      expect.objectContaining({ source: 'commands', code: 'invalid-frontmatter', path: join(workspaceDir, '.coko/commands/broken.md') }),
      expect.objectContaining({ source: 'commands', code: 'shadowed', path: join(dirs.cokoHome, 'commands/review.md') }),
    ])
    const sessionId = await newSession()
    expect((await api.get(`${commandPaths.commands}?sessionId=${sessionId}`)).body).toEqual(byWorkspace.body)
    expect(await api.get(commandPaths.commands)).toMatchObject({ status: 400, body: { error: { code: 'bad-request' } } })
    expect(await api.get(`${commandPaths.commands}?workspaceId=missing`)).toMatchObject({ status: 404, body: { error: { code: 'not-found' } } })
    expect(await api.get(`${commandPaths.commands}?sessionId=missing`)).toMatchObject({ status: 404, body: { error: { code: 'not-found' } } })
  })
})
