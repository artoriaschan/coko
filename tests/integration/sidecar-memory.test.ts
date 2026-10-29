// Memory：真实 Sidecar（faux 模型）经协议驱动。memory_write 的条目进入同 Workspace 新 Session 的 <memory> system section，
// 另一 Workspace 只看到用户级；memory_delete 后不再注入；default 模式写入要审批、accept-edits 免审批、memory_list 免审批；
// memory.enabled: false 时不注入、工具不在请求中；/api/memories 的增删改查与 Workspace 过滤；重启 Sidecar 后条目仍在。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, configPaths, memoryPaths, permissionPaths, type MemoryEntry } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval, type SidecarDirs, type Stream } from './sidecar-harness.ts'

type Api = ReturnType<typeof client>
type LoggedMessage = { role: string; sections?: Record<string, string | null>; toolsAdded?: { name: string }[]; toolsRemoved?: { name: string }[] }

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

async function boot(dirs: SidecarDirs, root: string, name: string, responses: unknown[]) {
  const requestLog = join(root, `${name}.jsonl`)
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses }, `${name}.json`)
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoggedMessage[])
  return { sidecar, api: client(sidecar, cookie), stream: await connect(sidecar, cookie), requests }
}

async function newSession(api: Api, stream: Stream, workspaceId: string, mode?: string) {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  if (mode) {
    const changed = await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })
    if (changed.status !== 200) throw new Error(`permission mode not set: ${changed.status}`)
  }
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return sessionId
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
async function send(api: Api, stream: Stream, sessionId: string, text: string, approve?: () => Promise<void>) {
  const before = runEnds(stream, sessionId)
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
  if (approve) await approve()
  await stream.waitFor(() => runEnds(stream, sessionId) > before)
}

/** 依次重放请求中的系统消息：当前的 sections 与模型可调用的工具名。 */
function replay(messages: LoggedMessage[]) {
  const sections: Record<string, string> = {}
  const tools = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'system') continue
    for (const [name, text] of Object.entries(m.sections ?? {})) {
      if (text === null) delete sections[name]
      else sections[name] = text
    }
    for (const t of m.toolsAdded ?? []) tools.add(t.name)
    for (const t of m.toolsRemoved ?? []) tools.delete(t.name)
  }
  return { sections, tools }
}

const toolResults = (stream: Stream, sessionId: string) =>
  stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    .map((e) => e.payload as { toolName: string; isError: boolean; details?: unknown; content: { text?: string }[] })

describe('Memory', () => {
  it('写入的条目注入后续 Session（按 Workspace 隔离），删除后不再注入；审批按模式；关闭后不注入也不注册工具；重启后仍在', { timeout: 120_000 }, async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const [one, two] = [join(root, 'one'), join(root, 'two')]
    await Promise.all([mkdir(one), mkdir(two)])
    const first = await boot(dirs, root, 'first', [
      // Session A（default）：memory_list 免审批；memory_write 等待审批。
      { content: [toolCall('l1', 'memory_list', {})] },
      { content: [toolCall('w1', 'memory_write', { content: 'This project uses pnpm', scope: 'workspace' })] },
      { content: 'noted' },
      // Session A（accept-edits）：memory_write 免审批。
      { content: [toolCall('w2', 'memory_write', { content: 'The user prefers answers in Chinese', scope: 'user' })] },
      { content: 'noted' },
      // 超长内容：参数错误，不执行。
      { content: [toolCall('w3', 'memory_write', { content: 'x'.repeat(2001), scope: 'user' })] },
      { content: 'too long' },
      // Session B（同 Workspace）与 Session C（另一 Workspace）。
      { content: 'b' },
      { content: 'c' },
    ])
    const { api, stream } = first
    const w1 = (await api.post(API_ROUTES.workspaces, { path: one })).body.id as string
    const w2 = (await api.post(API_ROUTES.workspaces, { path: two })).body.id as string

    const a = await newSession(api, stream, w1)
    await send(api, stream, a, 'remember the package manager', async () => {
      const request = await waitApproval(stream, a)
      expect(request).toMatchObject({ toolCallId: 'w1', toolName: 'memory_write', kind: 'tool', subject: 'This project uses pnpm' })
      expect((await api.post(apiPaths.sessionApproval(a, request.requestId), { decision: 'allow' })).status).toBe(204)
    })
    // 只有 memory_write 询问过；memory_list 在 default 下直接执行。
    expect(
      stream
        .entries(a)
        .filter((e) => e.kind === 'approval_request')
        .map((e) => (e.payload as { toolName: string }).toolName),
    ).toEqual(['memory_write'])
    expect((await api.put(permissionPaths.sessionPermissionMode(a), { mode: 'accept-edits' })).status).toBe(200)
    await send(api, stream, a, 'remember my preference')
    await send(api, stream, a, 'remember a lot')
    expect(stream.entries(a).filter((e) => e.kind === 'approval_request')).toHaveLength(1)
    const results = toolResults(stream, a)
    expect(results.map((r) => [r.toolName, r.isError])).toEqual([
      ['memory_list', false],
      ['memory_write', false],
      ['memory_write', false],
      ['memory_write', true],
    ])
    expect(results[0]!.content[0]!.text).toBe('No memories saved.')
    expect(results[1]!.details).toMatchObject({ action: 'created', memory: { scope: 'workspace', content: 'This project uses pnpm' } })
    expect(results[3]!.content[0]!.text).toMatch(/Validation failed for tool "memory_write"/)

    const listed = (await api.get(`${memoryPaths.memories}?workspaceId=${w1}`)).body.memories as MemoryEntry[]
    expect(listed.map((m) => [m.scope, m.workspaceId, m.content, m.source])).toEqual([
      ['user', null, 'The user prefers answers in Chinese', 'model'],
      ['workspace', w1, 'This project uses pnpm', 'model'],
    ])
    const workspaceMemory = listed.find((m) => m.scope === 'workspace')!

    const b = await newSession(api, stream, w1)
    await send(api, stream, b, 'hello')
    const c = await newSession(api, stream, w2)
    await send(api, stream, c, 'hello')
    const requests = await first.requests()
    const inB = replay(requests.at(-2)!)
    const inC = replay(requests.at(-1)!)
    expect(inB.sections.memory).toContain(`<entry id="${workspaceMemory.id}" scope="workspace">\nThis project uses pnpm\n</entry>`)
    expect(inB.sections.memory).toContain('The user prefers answers in Chinese')
    // 新的在前：用户级条目更晚写入。
    expect(inB.sections.memory!.indexOf('Chinese')).toBeLessThan(inB.sections.memory!.indexOf('pnpm'))
    expect(inC.sections.memory).toContain('The user prefers answers in Chinese')
    expect(inC.sections.memory).not.toContain('pnpm')
    for (const name of ['memory_list', 'memory_write', 'memory_delete']) expect(inB.tools.has(name)).toBe(true)
    // 默认开启的 memory 工具在开头的系统消息中声明：新 Session 的第一个 Run 不提交 system 条目（条目序列与 M2 相同）。
    expect(stream.entries(b).map((e) => e.kind)).not.toContain('system')
    expect(await first.sidecar.stop()).toEqual({ code: 0, signal: null })

    // 重启：条目仍在；accept-edits 下 memory_delete 免审批，之后不再注入；memory.enabled: false 时不注入、工具不在请求中。
    const second = await boot(dirs, root, 'second', [
      { content: [toolCall('d1', 'memory_delete', { id: workspaceMemory.id })] },
      { content: 'deleted' },
      { content: 'after delete' },
      { content: 'disabled' },
    ])
    expect(((await second.api.get(`${memoryPaths.memories}?workspaceId=${w1}`)).body.memories as MemoryEntry[]).map((m) => m.content)).toEqual([
      'The user prefers answers in Chinese',
      'This project uses pnpm',
    ])
    const d = await newSession(second.api, second.stream, w1, 'accept-edits')
    await send(second.api, second.stream, d, 'forget the package manager')
    expect(second.stream.entries(d).filter((e) => e.kind === 'approval_request')).toHaveLength(0)
    expect(toolResults(second.stream, d).map((r) => [r.toolName, r.isError, r.content[0]?.text])).toEqual([
      ['memory_delete', false, `Deleted memory ${workspaceMemory.id}.`],
    ])
    const e = await newSession(second.api, second.stream, w1)
    await send(second.api, second.stream, e, 'hello')
    const afterDelete = replay((await second.requests()).at(-1)!)
    expect(afterDelete.sections.memory).toContain('The user prefers answers in Chinese')
    expect(afterDelete.sections.memory).not.toContain('pnpm')

    expect((await second.api.put(configPaths.config, { values: { memory: { enabled: false } }, expectedRevision: 0 })).status).toBe(200)
    const f = await newSession(second.api, second.stream, w1)
    await send(second.api, second.stream, f, 'hello')
    const disabled = replay((await second.requests()).at(-1)!)
    expect(disabled.sections).not.toHaveProperty('memory')
    expect(JSON.stringify((await second.requests()).at(-1))).not.toContain('Chinese')
    expect([...disabled.tools].filter((name) => name.startsWith('memory_'))).toEqual([])
    // 前置：其余工具照常声明（证明重放读到了工具集）。
    expect(disabled.tools.has('read')).toBe(true)
    expect(await second.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('/api/memories 的增删改查、Workspace 过滤与校验；重启后条目仍在', { timeout: 60_000 }, async () => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const [one, two] = [join(root, 'one'), join(root, 'two')]
    await Promise.all([mkdir(one), mkdir(two)])
    const first = await boot(dirs, root, 'first', [])
    const { api } = first
    const w1 = (await api.post(API_ROUTES.workspaces, { path: one })).body.id as string
    const w2 = (await api.post(API_ROUTES.workspaces, { path: two })).body.id as string

    const user = await api.post(memoryPaths.memories, { scope: 'user', content: '  Prefers tabs  ' })
    expect(user.status).toBe(201)
    expect(user.body).toMatchObject({ scope: 'user', workspaceId: null, content: 'Prefers tabs', source: 'user' })
    const inOne = (await api.post(memoryPaths.memories, { scope: 'workspace', workspaceId: w1, content: 'One uses pnpm' })).body as MemoryEntry
    const inTwo = (await api.post(memoryPaths.memories, { scope: 'workspace', workspaceId: w2, content: 'Two uses npm' })).body as MemoryEntry
    const contents = async (query = '') => ((await api.get(`${memoryPaths.memories}${query}`)).body.memories as MemoryEntry[]).map((m) => m.content)
    expect(await contents(`?workspaceId=${w1}`)).toEqual(['One uses pnpm', 'Prefers tabs'])
    expect(await contents(`?workspaceId=${w2}`)).toEqual(['Two uses npm', 'Prefers tabs'])
    expect(await contents()).toEqual(['Prefers tabs'])
    expect((await api.get(`${memoryPaths.memories}?workspaceId=missing`)).status).toBe(404)

    // 校验：作用域与 workspaceId 不一致、超长、空白、未知字段 400；Workspace 不存在 404。
    expect((await api.post(memoryPaths.memories, { scope: 'workspace', content: 'x' })).status).toBe(400)
    expect((await api.post(memoryPaths.memories, { scope: 'user', workspaceId: w1, content: 'x' })).status).toBe(400)
    expect((await api.post(memoryPaths.memories, { scope: 'user', content: 'x'.repeat(2001) })).status).toBe(400)
    expect((await api.post(memoryPaths.memories, { scope: 'user', content: 'x'.repeat(2000) })).status).toBe(201)
    expect((await api.post(memoryPaths.memories, { scope: 'user', content: '   ' })).body.error.code).toBe('bad-request')
    expect((await api.post(memoryPaths.memories, { scope: 'user', content: 'x', source: 'model' })).status).toBe(400)
    expect((await api.post(memoryPaths.memories, { scope: 'workspace', workspaceId: 'missing', content: 'x' })).status).toBe(404)

    // 改：只改正文，source 不变；限定 Workspace 时另一 Workspace 的条目 404。
    const edited = await api.put(memoryPaths.memory(inOne.id), { content: 'One uses pnpm 12' })
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ id: inOne.id, content: 'One uses pnpm 12', scope: 'workspace', workspaceId: w1 })
    expect(edited.body.updatedAt).toBeGreaterThanOrEqual(inOne.updatedAt)
    expect((await api.put(`${memoryPaths.memory(inOne.id)}?workspaceId=${w2}`, { content: 'x' })).status).toBe(404)
    expect((await api.put(memoryPaths.memory('missing'), { content: 'x' })).status).toBe(404)
    // 删：限定另一 Workspace 时 404 且不删除；204 后不再列出，再删 404。
    expect((await api.delete(`${memoryPaths.memory(inTwo.id)}?workspaceId=${w1}`)).status).toBe(404)
    expect((await api.delete(memoryPaths.memory(inTwo.id))).status).toBe(204)
    expect((await api.delete(memoryPaths.memory(inTwo.id))).status).toBe(404)
    expect(await contents(`?workspaceId=${w2}`)).toEqual(['x'.repeat(2000), 'Prefers tabs'])
    expect(await first.sidecar.stop()).toEqual({ code: 0, signal: null })

    const second = await boot(dirs, root, 'second', [])
    // 编辑过的条目 updatedAt 最新，排在最前。
    const restored = (await second.api.get(`${memoryPaths.memories}?workspaceId=${w1}`)).body.memories as MemoryEntry[]
    expect(restored.map((m) => [m.id, m.content.length > 100 ? `<${m.content.length} chars>` : m.content])).toEqual([
      [inOne.id, 'One uses pnpm 12'],
      [expect.any(String), '<2000 chars>'],
      [user.body.id, 'Prefers tabs'],
    ])
    expect(await second.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
