// 记忆跟随项目归属（ADR 0027）：真实 Sidecar（faux 模型）。Session 属于项目时 Memory 段与 workspace 作用域针对项目主要文件夹的
// Workspace，不属于项目时只有用户级且工具没有 workspace 取值；移入、移出、换项目、删除项目、重建项目与更换主要文件夹从下一个 Run 生效，
// Run 进行中的移动不改变本次 Run；草稿的上下文用量按草稿所选项目计 Memory。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, contextPaths, memoryPaths, permissionPaths, type ContextUsageResponse, type MemoryEntry } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, type Stream } from './sidecar-harness.ts'

type Api = ReturnType<typeof client>
type Tool = { name: string; parameters?: unknown }
type LoggedMessage = { role: string; sections?: Record<string, string | null>; toolsAdded?: Tool[]; toolsRemoved?: { name: string }[] }

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const remember = (id: string, content: string, scope = 'workspace') => ({ content: [toolCall(id, 'memory_write', { content, scope })] })

/** 依次重放请求中的系统消息：当前的 sections 与模型可调用的工具（同名重新声明取最新的）。 */
function replay(messages: LoggedMessage[]) {
  const sections: Record<string, string> = {}
  const tools = new Map<string, Tool>()
  for (const m of messages) {
    if (m.role !== 'system') continue
    for (const [name, text] of Object.entries(m.sections ?? {})) {
      if (text === null) delete sections[name]
      else sections[name] = text
    }
    for (const t of m.toolsRemoved ?? []) tools.delete(t.name)
    for (const t of m.toolsAdded ?? []) tools.set(t.name, t)
  }
  return { memory: sections.memory ?? '', tools }
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
const approvals = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'approval_request')
const toolResults = (stream: Stream, sessionId: string) =>
  stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    .map((e) => e.payload as { toolCallId: string; isError: boolean; content: { text?: string }[] })

it('项目记忆跟随 Session 的项目归属，从下一个 Run 生效', { timeout: 120_000 }, async () => {
  const root = await tempDir()
  const [p, q, r] = [join(root, 'p'), join(root, 'q'), join(root, 'r')]
  await Promise.all([mkdir(p), mkdir(q), mkdir(r)])
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, {
    requestLog,
    responses: [
      { content: 'in P' },
      // 移出项目：workspace 作用域是参数错误；省略 scope 时为用户级。
      {
        content: [
          toolCall('w-none', 'memory_write', { content: 'Standalone fact', scope: 'workspace' }),
          toolCall('w-default', 'memory_write', { content: 'Standalone pref' }),
        ],
      },
      { content: 'standalone' },
      // 移入 P：写入落在 P。
      remember('w-p', 'P learned fact'),
      { content: 'moved into P' },
      { content: 'other P session' },
      // 移到 Q：写入落在 Q。
      remember('w-q', 'Q learned fact'),
      { content: 'moved into Q' },
      // Run 中移回 P：本次 Run 仍写入 Q。
      { content: [toolCall('barrier', 'write', { path: 'barrier.txt', content: 'x' })] },
      remember('w-mid', 'Written mid run'),
      { content: 'mid run' },
      { content: 'after delete' },
      { content: 'recreated' },
      { content: 'new primary' },
    ],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api: Api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoggedMessage[])
  const lastRequest = async () => replay((await requests()).at(-1)!)
  const projectOf = async (workspaceId: string) =>
    ((await api.get(API_ROUTES.projects)).body.projects as { id: string; primaryWorkspaceId: string }[]).find((x) => x.primaryWorkspaceId === workspaceId)!
  const open = async (workspaceId: string, mode = 'accept-edits') => {
    const id = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    expect((await api.put(permissionPaths.sessionPermissionMode(id), { mode })).status).toBe(200)
    stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === id)
    return id
  }
  const send = async (id: string, text: string) => {
    const before = runEnds(stream, id)
    expect((await api.post(apiPaths.sessionMessages(id), { text })).status).toBe(202)
    await stream.waitFor(() => runEnds(stream, id) > before)
  }
  const move = async (id: string, projectId: string | null) => expect((await api.put(apiPaths.sessionProject(id), { projectId })).status).toBe(200)
  const entries = async (workspaceId?: string) =>
    ((await api.get(`${memoryPaths.memories}${workspaceId ? `?workspaceId=${workspaceId}` : ''}`)).body.memories as MemoryEntry[]).map((m) => [
      m.scope,
      m.workspaceId,
      m.content,
    ])
  const scopes = (tool: Tool | undefined) => JSON.stringify(tool?.parameters)
  const draftSystem = async (workspaceId: string) => ((await api.get(contextPaths.workspace(workspaceId))).body as ContextUsageResponse).breakdown.system

  const wp = (await api.post(API_ROUTES.workspaces, { path: p })).body.id as string
  const wq = (await api.post(API_ROUTES.workspaces, { path: q })).body.id as string
  const [P, Q] = [await projectOf(wp), await projectOf(wq)]
  for (const body of [
    { scope: 'user', content: 'User prefers tabs' },
    { scope: 'workspace', workspaceId: wp, content: 'P uses pnpm' },
    { scope: 'workspace', workspaceId: wq, content: 'Q uses npm' },
  ])
    expect((await api.post(memoryPaths.memories, body)).status).toBe(201)

  // AC-01：项目 Session 的 Memory 段有项目级与用户级；工具有 workspace 作用域。
  const s = await open(wp)
  await send(s, 'hello')
  let request = await lastRequest()
  expect(request.memory).toContain('P uses pnpm')
  expect(request.memory).toContain('User prefers tabs')
  expect(request.memory).not.toContain('Q uses npm')
  expect(request.memory).toContain('scope "workspace"')
  expect(scopes(request.tools.get('memory_write'))).toContain('"workspace"')

  // AC-02、AC-03、AC-07：移出项目（工作目录仍是 P 的文件夹）后只有用户级；工具没有 workspace 取值，以 workspace 调用是参数错误。
  await move(s, null)
  await send(s, 'remember a standalone fact')
  request = replay((await requests()).at(-2)!)
  expect(request.memory).toContain('User prefers tabs')
  expect(request.memory).not.toContain('P uses pnpm')
  expect(request.memory).not.toMatch(/workspace/)
  for (const name of ['memory_write', 'memory_list']) expect(scopes(request.tools.get(name))).not.toContain('"workspace"')
  expect(scopes(request.tools.get('memory_write'))).toContain('"user"')
  const none = toolResults(stream, s).find((t) => t.toolCallId === 'w-none')!
  expect(none.isError).toBe(true)
  expect(none.content[0]!.text).toMatch(/Validation failed for tool "memory_write"/)
  expect(toolResults(stream, s).find((t) => t.toolCallId === 'w-default')!.isError).toBe(false)
  expect(await entries()).toContainEqual(['user', null, 'Standalone pref'])
  expect((await entries()).map((e) => e[2])).not.toContain('Standalone fact')
  expect(await entries(wp)).toContainEqual(['workspace', wp, 'P uses pnpm'])

  // AC-04：独立对话移入 P：下一个 Run 有 P 的项目记忆；写入落在 P，P 的其他 Session 的下一个 Run 可见。
  await move(s, P.id)
  await send(s, 'remember in P')
  expect(replay((await requests()).at(-2)!).memory).toContain('P uses pnpm')
  expect(await entries(wp)).toContainEqual(['workspace', wp, 'P learned fact'])
  const other = await open(wp)
  await send(other, 'hello')
  expect((await lastRequest()).memory).toContain('P learned fact')

  // AC-06：移到 Q：Memory 段是 Q 的，不含 P 的；写入落在 Q。
  await move(s, Q.id)
  await send(s, 'remember in Q')
  request = replay((await requests()).at(-2)!)
  expect(request.memory).toContain('Q uses npm')
  expect(request.memory).not.toContain('P uses pnpm')
  expect(await entries(wq)).toContainEqual(['workspace', wq, 'Q learned fact'])

  // AC-05：Run 进行中移回 P，本次 Run 后续的写入仍落在 Q（Run 开始时的归属）。
  expect((await api.put(permissionPaths.sessionPermissionMode(s), { mode: 'default' })).status).toBe(200)
  const before = runEnds(stream, s)
  expect((await api.post(apiPaths.sessionMessages(s), { text: 'mid run' })).status).toBe(202)
  await stream.waitFor(() => approvals(stream, s).length >= 1)
  await move(s, P.id)
  // 之后的记忆写入若仍需审批（审批取消之前）一并允许。
  for (let answered = 0; runEnds(stream, s) === before;) {
    await stream.waitFor(() => runEnds(stream, s) > before || approvals(stream, s).length > answered)
    for (const pending of approvals(stream, s).slice(answered)) {
      const { requestId } = pending.payload as { requestId: string }
      expect((await api.post(apiPaths.sessionApproval(s, requestId), { decision: 'allow' })).status).toBe(204)
      answered++
    }
  }
  expect(await entries(wq)).toContainEqual(['workspace', wq, 'Written mid run'])
  expect((await entries(wp)).map((e) => e[2])).not.toContain('Written mid run')

  // 草稿按所选项目计 Memory：P 存在时 P 主要 Workspace 的草稿含 P 的项目记忆。
  const inProject = await draftSystem(wp)

  // AC-07：删除 P 后 Session 只有用户级；P 的项目记忆仍在库中；草稿不再计入 P 的项目记忆。
  expect((await api.delete(apiPaths.project(P.id))).status).toBe(200)
  await send(s, 'after delete')
  request = await lastRequest()
  expect(request.memory).toContain('User prefers tabs')
  expect(request.memory).not.toContain('P uses pnpm')
  expect(await entries(wp)).toContainEqual(['workspace', wp, 'P uses pnpm'])
  expect(await draftSystem(wp)).toBeLessThan(inProject)

  // AC-08：用同一文件夹重新建项目：新项目中的 Session 看到删除前的项目记忆。
  const recreated = await api.post(API_ROUTES.projects, { name: 'P again', folders: [{ path: p, primary: true }] })
  expect(recreated.body.status).toBe('created')
  const u = await open(wp)
  await send(u, 'hello again')
  expect((await lastRequest()).memory).toContain('P uses pnpm')

  // AC-11：Q 更换主要文件夹：Q 的 Session 的下一个 Run 使用新文件夹上的记忆，原记忆仍在原 Workspace 上。
  const v = await open(wq)
  expect((await api.put(apiPaths.project(Q.id), { name: 'Q', folders: [{ path: r, primary: true }] })).status).toBe(200)
  const wr = ((await api.get(API_ROUTES.projects)).body.projects as { id: string; primaryWorkspaceId: string }[]).find((x) => x.id === Q.id)!.primaryWorkspaceId
  expect(wr).not.toBe(wq)
  expect((await api.post(memoryPaths.memories, { scope: 'workspace', workspaceId: wr, content: 'R uses yarn' })).status).toBe(201)
  await send(v, 'hello R')
  request = await lastRequest()
  expect(request.memory).toContain('R uses yarn')
  expect(request.memory).not.toContain('Q uses npm')
  expect(await entries(wq)).toContainEqual(['workspace', wq, 'Q uses npm'])
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})
